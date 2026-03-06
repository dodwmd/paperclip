#!/usr/bin/env node
/**
 * apply-publish-config.mjs
 *
 * Applies publishConfig.exports (and main/types) to the exports field in
 * workspace package.json files. Used on the production server after rsync so
 * that Node.js resolves workspace packages to compiled dist/ output rather
 * than TypeScript source files.
 *
 * Usage: node scripts/apply-publish-config.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const workspacePackages = [
  "packages/shared",
  "packages/db",
  "packages/adapter-utils",
  "packages/adapters/claude-local",
  "packages/adapters/codex-local",
  "packages/adapters/cursor-local",
  "packages/adapters/opencode-local",
  "packages/adapters/openclaw",
];

for (const pkgDir of workspacePackages) {
  const pkgPath = resolve(root, pkgDir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    console.error(`Skipping ${pkgDir}: could not read package.json`);
    continue;
  }

  if (!pkg.publishConfig) continue;

  let changed = false;
  if (pkg.publishConfig.exports) {
    pkg.exports = pkg.publishConfig.exports;
    changed = true;
  }
  if (pkg.publishConfig.main) {
    pkg.main = pkg.publishConfig.main;
    changed = true;
  }
  if (pkg.publishConfig.types) {
    pkg.types = pkg.publishConfig.types;
    changed = true;
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  ✓  ${pkgDir}`);
  }
}

console.log("Done.");
