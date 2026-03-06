import fs from "node:fs/promises";
import { resolveDefaultAgentHomeDir, resolveDefaultAgentHomeTemplateDir } from "./home-paths.js";

/**
 * Ensure an agent has its own private home directory.
 * If the directory doesn't exist yet it is created by copying the
 * agent-home-template directory (if present) or as an empty directory.
 * Returns the resolved home dir path.
 */
export async function ensureAgentHomeDir(agentId: string): Promise<string> {
  const homeDir = resolveDefaultAgentHomeDir(agentId);

  const exists = await fs.access(homeDir).then(() => true).catch(() => false);
  if (exists) return homeDir;

  const templateDir = resolveDefaultAgentHomeTemplateDir();
  const templateExists = await fs.access(templateDir).then(() => true).catch(() => false);

  if (templateExists) {
    await fs.cp(templateDir, homeDir, { recursive: true });
  } else {
    await fs.mkdir(homeDir, { recursive: true });
  }

  return homeDir;
}

/**
 * Ensure home dirs exist for every agent id in the list.
 * Errors are collected and returned rather than thrown so one failure
 * doesn't block the rest.
 */
export async function ensureAgentHomeDirsForAll(
  agentIds: string[],
): Promise<{ agentId: string; error: unknown }[]> {
  const results = await Promise.allSettled(agentIds.map((id) => ensureAgentHomeDir(id)));
  const failures: { agentId: string; error: unknown }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "rejected") {
      failures.push({ agentId: agentIds[i]!, error: r.reason });
    }
  }
  return failures;
}
