#!/usr/bin/env node

/**
 * Universal Cross-Platform Dispatcher for Pikaa / Groupy Agent.
 *
 * Priority order:
 * 1. Precompiled native binary (zero-dependency, instant start)
 * 2. Bun runtime running the bundled JS (requires Bun installed)
 * 3. Clear error message pointing user to install Bun
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

// Map OS & Arch to precompiled binary filename
function getBinaryName() {
  if (platform === "win32") {
    return arch === "arm64" ? "pikaa-windows-arm64.exe" : "pikaa-windows-x64.exe";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "pikaa-darwin-arm64" : "pikaa-darwin-x64";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "pikaa-linux-arm64" : "pikaa-linux-x64";
  }
  return null;
}

// --- 1. Try native binary ---
const binaryName = getBinaryName();
let nativeBinaryPath = null;

if (binaryName) {
  for (const p of [
    join(rootDir, "dist", "bin", binaryName),
    join(rootDir, "bin", binaryName),
    join(rootDir, binaryName),
  ]) {
    if (existsSync(p)) {
      nativeBinaryPath = p;
      break;
    }
  }
}

if (nativeBinaryPath) {
  if (platform !== "win32") {
    try { chmodSync(nativeBinaryPath, 0o755); } catch {}
  }
  const result = spawnSync(nativeBinaryPath, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? (result.error ? 1 : 0));
}

// --- 2. Fallback: run via Bun (dist/cli.js is a Bun bundle) ---
const jsEntry = join(rootDir, "dist", "cli.js");

if (!existsSync(jsEntry)) {
  console.error("pikaa: dist/cli.js not found. Please reinstall the package.");
  process.exit(1);
}

// Find Bun executable
const bunCandidates = platform === "win32"
  ? ["bun.exe"]
  : ["bun"];

let bunBin = null;
for (const candidate of bunCandidates) {
  const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
  if (!probe.error) {
    bunBin = candidate;
    break;
  }
}

if (!bunBin) {
  console.error([
    "",
    "  pikaa requires Bun to run.",
    "  Install Bun with:",
    "",
    "    curl -fsSL https://bun.sh/install | bash   # macOS / Linux",
    "    powershell -c \"irm bun.sh/install.ps1 | iex\"  # Windows",
    "",
    "  Then re-run:  pikaa",
    "",
  ].join("\n"));
  process.exit(1);
}

const result = spawnSync(bunBin, ["run", jsEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? (result.error ? 1 : 0));
