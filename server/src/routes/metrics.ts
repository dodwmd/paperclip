import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { metricsService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";

export function metricsRoutes(db: Db) {
  const router = Router();
  const metrics = metricsService(db);

  function parseDateRange(query: Record<string, unknown>) {
    const from = query.from ? new Date(query.from as string) : undefined;
    const to = query.to ? new Date(query.to as string) : undefined;
    return (from || to) ? { from, to } : undefined;
  }

  router.get("/companies/:companyId/metrics/tool-usage", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await metrics.toolUsage(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/metrics/tool-usage/by-agent", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await metrics.toolUsageByAgent(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/metrics/run-stats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseDateRange(req.query);
    const stats = await metrics.runStats(companyId, range);
    res.json(stats);
  });

  return router;
}
