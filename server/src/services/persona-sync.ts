import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { ensureAgentHomeDir } from "../agent-home.js";
import { logActivity } from "./activity-log.js";

export type FileSyncStatus = "changed" | "unchanged" | "error";

export interface FileSyncDetail {
  name: string;
  status: FileSyncStatus;
  error?: string;
}

export interface PersonaSyncResult {
  ok: true;
  syncedAt: Date;
  filesSynced: string[];
  fileDetails: FileSyncDetail[];
  sha: string | null;
}

export interface PersonaSyncError {
  ok: false;
  error: string;
}

export interface PersonaStatusResult {
  remoteSha: string | null;
  localSha: string | null;
  inSync: boolean;
  permissionError: boolean;
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

  if (res.status === 403 || res.status === 401) {
    throw new PermissionError(`GitHub permission denied (HTTP ${res.status})`);
  }
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

/** Fetch the latest commit SHA for a given path+branch via the commits API. */
async function fetchLatestPathSha(
  owner: string,
  repo: string,
  branch: string,
  subdir: string,
): Promise<string | null> {
  const pathParam = subdir ? `&path=${encodeURIComponent(subdir)}` : "";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}${pathParam}&per_page=1`;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "paperclip-persona-sync/1.0",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (Array.isArray(data) && data.length > 0 && typeof (data[0] as { sha?: unknown }).sha === "string") {
      return (data[0] as { sha: string }).sha;
    }
    return null;
  } catch {
    return null;
  }
}

class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
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
 * Tracks whether each file changed vs. was identical to existing content.
 * Returns FileSyncDetail[] for each file attempted.
 */
async function downloadDirectoryToHome(
  homeDir: string,
  owner: string,
  repo: string,
  branch: string,
  subdir: string,
): Promise<FileSyncDetail[]> {
  const items = await fetchGitHubContents(owner, repo, subdir, branch);
  const details: FileSyncDetail[] = [];

  for (const item of items) {
    if (item.type === "file" && item.download_url) {
      try {
        const content = await downloadFile(item.download_url);
        const destPath = path.join(homeDir, item.name);
        let existing: string | null = null;
        try {
          existing = await fs.readFile(destPath, "utf-8");
        } catch {
          // File didn't exist yet — treat as changed
        }
        await fs.writeFile(destPath, content, "utf-8");
        details.push({
          name: item.name,
          status: existing === null || existing !== content ? "changed" : "unchanged",
        });
      } catch (err) {
        details.push({
          name: item.name,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (item.type === "dir" && item.name === ".claude") {
      // Recurse into .claude/ directory
      const claudeDir = path.join(homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      try {
        const subdirItems = await fetchGitHubContents(
          owner,
          repo,
          subdir ? `${subdir}/${item.name}` : item.name,
          branch,
        );
        for (const subItem of subdirItems) {
          if (subItem.type === "file" && subItem.download_url) {
            try {
              const subContent = await downloadFile(subItem.download_url);
              const subDest = path.join(claudeDir, subItem.name);
              let existing: string | null = null;
              try {
                existing = await fs.readFile(subDest, "utf-8");
              } catch {
                // New file
              }
              await fs.writeFile(subDest, subContent, "utf-8");
              details.push({
                name: `.claude/${subItem.name}`,
                status: existing === null || existing !== subContent ? "changed" : "unchanged",
              });
            } catch (err) {
              details.push({
                name: `.claude/${subItem.name}`,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        details.push({
          name: ".claude/",
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Other subdirectories and non-file types are intentionally skipped
  }

  return details;
}

/**
 * Check the remote HEAD SHA for the agent's persona git URL without downloading files.
 */
export async function checkPersonaRemoteSha(
  personaGitUrl: string,
  localSha: string | null,
): Promise<PersonaStatusResult> {
  const parsed = parseGitHubTreeUrl(personaGitUrl);
  if (!parsed) {
    return { remoteSha: null, localSha, inSync: false, permissionError: false };
  }

  try {
    const remoteSha = await fetchLatestPathSha(parsed.owner, parsed.repo, parsed.branch, parsed.subdir);
    return {
      remoteSha,
      localSha,
      inSync: remoteSha !== null && remoteSha === localSha,
      permissionError: false,
    };
  } catch (err) {
    const isPermission = err instanceof PermissionError;
    return {
      remoteSha: null,
      localSha,
      inSync: false,
      permissionError: isPermission,
    };
  }
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

    // Fetch remote SHA and files concurrently
    const [fileDetails, sha] = await Promise.all([
      downloadDirectoryToHome(homeDir, parsed.owner, parsed.repo, parsed.branch, parsed.subdir),
      fetchLatestPathSha(parsed.owner, parsed.repo, parsed.branch, parsed.subdir),
    ]);

    const filesSynced = fileDetails.filter((d) => d.status !== "error").map((d) => d.name);

    await db
      .update(agents)
      .set({
        personaLastSyncedAt: new Date(),
        personaLastSyncError: null,
        personaGitSha: sha,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

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
        sha,
      },
    });

    const syncedAt = new Date();
    return { ok: true, syncedAt, filesSynced, fileDetails, sha };
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
