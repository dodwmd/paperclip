import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
  createCompanySchema,
  kanbanConfigSchema,
  updateCompanySchema,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService, agentService, companyPortabilityService, companyService, logActivity, syncKanbanConfig, checkKanbanRemoteSha } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";

export function companyRoutes(db: Db) {
  const router = Router();
  const svc = companyService(db);
  const portability = companyPortabilityService(db);
  const access = accessService(db);
  const agents = agentService(db);

  async function assertBoardOrCeoAgent(req: Request, companyId: string) {
    if (req.actor.type === "board") return;
    if (req.actor.type === "agent" && req.actor.agentId) {
      const agent = await agents.getById(req.actor.agentId);
      if (agent && agent.companyId === companyId && agent.role === "ceo") return;
    }
    throw forbidden("Board or CEO agent access required");
  }

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(result.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.companyIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId)));
    res.json(filtered);
  });

  // Common malformed path when companyId is empty in "/api/companies/{companyId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  router.get("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(company);
  });

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null);
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.imported",
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
      },
    });
    res.json(result);
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const company = await svc.create(req.body);
    await access.ensureMembership(company.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    res.status(201).json(company);
  });

  router.patch("/:companyId", validate(updateCompanySchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.update(companyId, req.body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  // ── Kanban config ──────────────────────────────────────────────────────────

  router.get("/:companyId/kanban-config", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertBoardOrCeoAgent(req, companyId);
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ config: company.kanbanConfig ?? null });
  });

  // NOTE: This endpoint intentionally uses manual safeParse instead of the validate() middleware.
  // The body may be null (to reset kanban config to defaults), which validate() does not support
  // since it calls schema.parse(req.body) unconditionally on a non-nullable schema.
  router.put("/:companyId/kanban-config", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertBoardOrCeoAgent(req, companyId);
    assertCompanyAccess(req, companyId);

    const existing = await svc.getById(companyId);
    if (!existing) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    if (existing.kanbanGitUrl) {
      res.status(409).json({ error: "Kanban config is managed by a git URL. Clear the kanbanGitUrl before editing manually." });
      return;
    }

    try {
      // null body = reset to defaults
      const rawConfig = req.body?.config ?? req.body ?? null;
      let kanbanConfig = null;
      if (rawConfig !== null) {
        const parsed = kanbanConfigSchema.safeParse(rawConfig);
        if (!parsed.success) {
          res.status(422).json({ error: "Invalid kanban config", details: parsed.error.flatten() });
          return;
        }
        kanbanConfig = parsed.data;
      }

      const company = await svc.update(companyId, { kanbanConfig });
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      const actorInfo = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action: "company.kanban_config_updated",
        entityType: "company",
        entityId: companyId,
        details: { hasCustomConfig: kanbanConfig !== null },
      });
      res.json(company);
    } catch (err) {
      logger.error({ err }, "PUT /kanban-config failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/:companyId/kanban-git-status", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    if (!company.kanbanGitUrl) {
      res.status(422).json({ error: "Company does not have a kanbanGitUrl configured" });
      return;
    }
    const result = await checkKanbanRemoteSha(company.kanbanGitUrl, company.kanbanGitSha ?? null);
    res.json(result);
  });

  router.post("/:companyId/sync-kanban-config", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    if (!company.kanbanGitUrl) {
      res.status(422).json({ error: "Company does not have a kanbanGitUrl configured" });
      return;
    }
    const actor = getActorInfo(req);
    const result = await syncKanbanConfig(db, { id: company.id, companyId: company.id, kanbanGitUrl: company.kanbanGitUrl, kanbanGitSha: company.kanbanGitSha ?? null }, actor);
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  });

  router.post("/:companyId/archive", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.archive(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.archived",
      entityType: "company",
      entityId: companyId,
    });
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.remove(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.deleted",
      entityType: "company",
      entityId: company.id,
    });
    res.json({ ok: true });
  });

  return router;
}
