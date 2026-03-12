import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { ensureAgentHomeDir, writeInstructionFile, INSTRUCTION_FILES } from "../agent-home.js";
import { logActivity } from "./activity-log.js";

export interface PersonaSyncResult {
  ok: true;
  syncedAt: Date;
  filesSynced: string[];
}

export interface PersonaSyncError {
  ok: false;
  error: string;
}

interface GitHubContentItem {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url: string | null;
  path: string;
}

/**
 * Parses a GitHub tree URL into its component parts.
 * Accepts: https://github.com/{owner}/{repo}/tree/{branch}/{subdir}
 * Also accepts bare repo URLs (no tree/branch/path) with optional trailing slash.
 */
export function parseGitHubTreeUrl(url: string): {
  owner: string;
  repo: string;
  branch: string;
  subdir: string;
} | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;

    // /owner/repo/tree/branch/path/to/dir
    const parts = parsed.pathname.replace(/^\//, "").split("/");
    const [owner, repo, keyword, branch, ...subdirParts] = parts;

    if (!owner || !repo) return null;

    if (keyword !== "tree" || !branch) {
      // Bare repo URL — use "master" default, root subdir
      const cleanRepo = repo.replace(/\.git$/, "");
      return { owner, repo: cleanRepo, branch: "master", subdir: "" };
    }

    return {
      owner,
      repo: repo.replace(/\.git$/, ""),
      branch,
      subdir: subdirParts.join("/"),
    };
  } catch {
    return null;
  }
}

async function fetchGitHubContents(
  owner: string,
  repo: string,
  contentPath: string,
  branch: string,
): Promise<GitHubContentItem[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}?ref=${branch}`;
  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "paperclip-persona-sync/1.0",
    },
  });

  if (res.status === 404) {
    throw new Error(`Path not found in repository: ${contentPath || "/"}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`Expected a directory listing from GitHub API but got a file object`);
  }
  return data as GitHubContentItem[];
}

async function downloadFile(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl, {
    headers: { "User-Agent": "paperclip-persona-sync/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Failed to download file from ${downloadUrl}: HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * Download all files from a GitHub directory into the agent's home dir.
 * Handles the known instruction files (AGENTS.md etc.) plus the .claude/ subdirectory.
 * Returns list of file names that were written.
 */
async function downloadDirectoryToHome(
  homeDir: string,
  owner: string,
  repo: string,
  branch: string,
  subdir: string,
): Promise<string[]> {
  const items = await fetchGitHubContents(owner, repo, subdir, branch);
  const synced: string[] = [];

  for (const item of items) {
    if (item.type === "file" && item.download_url) {
      const content = await downloadFile(item.download_url);
      const destPath = path.join(homeDir, item.name);
      await fs.writeFile(destPath, content, "utf-8");
      synced.push(item.name);
    } else if (item.type === "dir" && item.name === ".claude") {
      // Recurse into .claude/ directory
      const claudeDir = path.join(homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      const subdirItems = await fetchGitHubContents(
        owner,
        repo,
        subdir ? `${subdir}/${item.name}` : item.name,
        branch,
      );
      for (const subItem of subdirItems) {
        if (subItem.type === "file" && subItem.download_url) {
          const subContent = await downloadFile(subItem.download_url);
          const subDest = path.join(claudeDir, subItem.name);
          await fs.writeFile(subDest, subContent, "utf-8");
          synced.push(`.claude/${subItem.name}`);
        }
      }
    }
    // Other subdirectories and non-file types are intentionally skipped
  }

  return synced;
}

/**
 * Sync an agent's persona files from its configured git URL.
 * Downloads AGENTS.md, HEARTBEAT.md, SOUL.md, TOOLS.md and .claude/ contents
 * into the agent's home directory. Updates sync metadata in the DB.
 */
export async function syncAgentPersona(
  db: Db,
  agent: {
    id: string;
    companyId: string;
    personaGitUrl: string;
  },
  actor: {
    actorType: "agent" | "user" | "system";
    actorId: string;
    agentId: string | null;
    runId: string | null;
  },
): Promise<PersonaSyncResult | PersonaSyncError> {
  const parsed = parseGitHubTreeUrl(agent.personaGitUrl);
  if (!parsed) {
    const error = `Invalid persona Git URL — must be a GitHub tree URL (e.g. https://github.com/owner/repo/tree/branch/path)`;
    await db
      .update(agents)
      .set({ personaLastSyncError: error, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));
    return { ok: false, error };
  }

  try {
    const homeDir = await ensureAgentHomeDir(agent.id);
    const filesSynced = await downloadDirectoryToHome(
      homeDir,
      parsed.owner,
      parsed.repo,
      parsed.branch,
      parsed.subdir,
    );

    // If AGENTS.md was downloaded, ensure the adapter config instructionsFilePath is set
    if (filesSynced.includes("AGENTS.md")) {
      const agentsMdPath = path.join(homeDir, "AGENTS.md");
      // Update instructionsFilePath in adapterConfig if not already pointing to agent home
      await db
        .update(agents)
        .set({
          personaLastSyncedAt: new Date(),
          personaLastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    } else {
      await db
        .update(agents)
        .set({
          personaLastSyncedAt: new Date(),
          personaLastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }

    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "agent.persona_synced",
      entityType: "agent",
      entityId: agent.id,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      details: {
        personaGitUrl: agent.personaGitUrl,
        filesSynced,
      },
    });

    const syncedAt = new Date();
    return { ok: true, syncedAt, filesSynced };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(agents)
      .set({ personaLastSyncError: error, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "agent.persona_sync_failed",
      entityType: "agent",
      entityId: agent.id,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      details: { personaGitUrl: agent.personaGitUrl, error },
    });

    return { ok: false, error };
  }
}
