import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { companies } from "@paperclipai/db";
import type { Db } from "@paperclipai/db";
import { kanbanConfigSchema } from "@paperclipai/shared";
import { logActivity } from "./activity-log.js";

export interface KanbanGitSyncResult {
  ok: true;
  syncedAt: Date;
  sha: string;
  columnsCount: number;
  rulesCount: number;
}

export interface KanbanGitSyncError {
  ok: false;
  error: string;
}

export interface KanbanGitStatusResult {
  remoteSha: string | null;
  localSha: string | null;
  inSync: boolean;
  fetchError: boolean;
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function fetchRemoteContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "paperclip-kanban-git-sync/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch kanban config: HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function checkKanbanRemoteSha(
  kanbanGitUrl: string,
  localSha: string | null,
): Promise<KanbanGitStatusResult> {
  try {
    const content = await fetchRemoteContent(kanbanGitUrl);
    const remoteSha = sha256Hex(content);
    return { remoteSha, localSha, inSync: remoteSha === localSha, fetchError: false };
  } catch {
    return { remoteSha: null, localSha, inSync: false, fetchError: true };
  }
}

export async function syncKanbanConfig(
  db: Db,
  company: { id: string; companyId?: string; kanbanGitUrl: string; kanbanGitSha: string | null },
  actor: { actorType: "agent" | "user" | "system"; actorId: string; agentId: string | null; runId: string | null },
): Promise<KanbanGitSyncResult | KanbanGitSyncError> {
  const companyId = company.companyId ?? company.id;

  const storeError = async (error: string) => {
    await db.update(companies).set({ kanbanLastSyncError: error, updatedAt: new Date() }).where(eq(companies.id, company.id));
  };

  try {
    const content = await fetchRemoteContent(company.kanbanGitUrl);
    const sha = sha256Hex(content);

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch (parseErr) {
      const error = `Invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
      await storeError(error);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "company.kanban_git_sync_failed",
        entityType: "company",
        entityId: company.id,
        agentId: actor.agentId,
        runId: actor.runId,
        details: { kanbanGitUrl: company.kanbanGitUrl, error },
      });
      return { ok: false, error };
    }

    const parsed = kanbanConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const error = `Config validation failed: ${JSON.stringify(parsed.error.flatten())}`;
      await storeError(error);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "company.kanban_git_sync_failed",
        entityType: "company",
        entityId: company.id,
        agentId: actor.agentId,
        runId: actor.runId,
        details: { kanbanGitUrl: company.kanbanGitUrl, error },
      });
      return { ok: false, error };
    }

    const config = parsed.data;
    await db.update(companies).set({
      kanbanConfig: config,
      kanbanLastSyncedAt: new Date(),
      kanbanLastSyncError: null,
      kanbanGitSha: sha,
      updatedAt: new Date(),
    }).where(eq(companies.id, company.id));

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.kanban_git_synced",
      entityType: "company",
      entityId: company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        kanbanGitUrl: company.kanbanGitUrl,
        sha,
        columnsCount: config.columns.length,
        rulesCount: config.rules.length,
      },
    });

    return { ok: true, syncedAt: new Date(), sha, columnsCount: config.columns.length, rulesCount: config.rules.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await storeError(error);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.kanban_git_sync_failed",
      entityType: "company",
      entityId: company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: { kanbanGitUrl: company.kanbanGitUrl, error },
    });
    return { ok: false, error };
  }
}
