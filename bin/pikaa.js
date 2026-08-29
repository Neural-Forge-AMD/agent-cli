#!/usr/bin/env node

/**
 * Universal Cross-Platform Dispatcher for Pikaa / Groupy Agent.
 *
 * 1. Runs precompiled native binary if present (downloaded by postinstall)
 * 2. Falls back to Bun if installed (rare, for unsupported platforms)
 * 3. Shows helpful install instructions if neither is available
 */

import { spawnSync } from "node:child_process";
import { existsSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const platform = process.platform;
const arch = process.arch;

function getBinaryName() {
  if (platform === "win32") return arch === "arm64" ? "pikaa-windows-arm64.exe" : "pikaa-windows-x64.exe";
  if (platform === "darwin") return arch === "arm64" ? "pikaa-darwin-arm64" : "pikaa-darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "pikaa-linux-arm64" : "pikaa-linux-x64";
  return null;
}

// --- 1. Native binary (postinstall should have placed it here) ---
const binaryName = getBinaryName();
if (binaryName) {
  for (const p of [
    join(rootDir, "bin", binaryName),
    join(rootDir, "dist", "bin", binaryName),
  ]) {
    if (existsSync(p)) {
      if (platform !== "win32") {
        try { chmodSync(p, 0o755); } catch {}
      }
      const r = spawnSync(p, process.argv.slice(2), { stdio: "inherit", env: process.env });
      process.exit(r.status ?? (r.error ? 1 : 0));
    }
  }
}

// --- 2. Fallback: run via Bun ---
const jsEntry = join(rootDir, "dist", "cli.js");
if (existsSync(jsEntry)) {
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (!probe.error) {
    const r = spawnSync("bun", ["run", jsEntry, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
    });
    process.exit(r.status ?? (r.error ? 1 : 0));
  }
}

// --- 3. Nothing worked ---
console.error([
  "",
  "  pikaa could not start.",
  "  The precompiled binary may have failed to download during install.",
  "",
  "  Try reinstalling:",
  "    npm install -g @pikaa-ai/pikaa",
  "",
  "  Or install Bun as a fallback runtime:",
  "    curl -fsSL https://bun.sh/install | bash",
  "",
].join("\n"));
process.exit(1);
