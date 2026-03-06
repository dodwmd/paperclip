import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentHomeDir, resolveDefaultAgentHomeTemplateDir } from "./home-paths.js";

export const INSTRUCTION_FILES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"] as const;
export type InstructionFileName = (typeof INSTRUCTION_FILES)[number];

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

/**
 * Migrate instruction files from the old shared-workspace location
 * (e.g. <workspace>/agents/<urlKey>/) to the agent's private home dir.
 *
 * - Only copies files that don't already exist at the destination.
 * - Returns the canonical path for AGENTS.md in the home dir (to update
 *   instructionsFilePath in the DB), plus whether anything was copied.
 */
export async function migrateInstructionFilesToAgentHome(
  agentId: string,
  existingInstructionsPath: string | null,
): Promise<{ agentsMdPath: string; anyCopied: boolean }> {
  const homeDir = await ensureAgentHomeDir(agentId);
  const agentsMdPath = path.join(homeDir, "AGENTS.md");
  const oldDir = existingInstructionsPath ? path.dirname(existingInstructionsPath) : null;

  let anyCopied = false;
  for (const file of INSTRUCTION_FILES) {
    const dest = path.join(homeDir, file);
    const destExists = await fs.access(dest).then(() => true).catch(() => false);
    if (destExists) continue;

    if (oldDir) {
      const src = path.join(oldDir, file);
      const srcExists = await fs.access(src).then(() => true).catch(() => false);
      if (srcExists) {
        await fs.copyFile(src, dest);
        anyCopied = true;
      }
    }
  }

  return { agentsMdPath, anyCopied };
}

/** Read an instruction file from the agent's home dir. Returns null if not found. */
export async function readInstructionFile(
  agentId: string,
  filename: InstructionFileName,
): Promise<string | null> {
  const homeDir = resolveDefaultAgentHomeDir(agentId);
  const filePath = path.join(homeDir, filename);
  return fs.readFile(filePath, "utf-8").catch(() => null);
}

/** Write an instruction file to the agent's home dir (creates dir if needed). */
export async function writeInstructionFile(
  agentId: string,
  filename: InstructionFileName,
  content: string,
): Promise<string> {
  const homeDir = await ensureAgentHomeDir(agentId);
  const filePath = path.join(homeDir, filename);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}
