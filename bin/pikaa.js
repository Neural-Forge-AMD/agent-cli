#!/usr/bin/env node

/**
 * Universal Cross-Platform Dispatcher for Pikaa / Groupy Agent.
 *
 * Automatically detects platform (Windows, macOS, Linux) and architecture (x64, arm64).
 * If a native compiled binary is present, executes it for instant native performance.
 * Otherwise, seamlessly falls back to the bundled JavaScript runtime.
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

const binaryName = getBinaryName();
let nativeBinaryPath = null;

if (binaryName) {
  const possiblePaths = [
    join(rootDir, "dist", "bin", binaryName),
    join(rootDir, "bin", binaryName),
    join(rootDir, binaryName),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      nativeBinaryPath = p;
      break;
    }
  }
}

if (nativeBinaryPath) {
  // Ensure execute permissions on Unix
  if (platform !== "win32") {
    try {
      chmodSync(nativeBinaryPath, 0o755);
    } catch {}
  }

  const result = spawnSync(nativeBinaryPath, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`Failed to launch native binary: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
} else {
  // Fallback to JS module execution
  const jsEntry = existsSync(join(rootDir, "dist", "cli.js"))
    ? join(rootDir, "dist", "cli.js")
    : join(rootDir, "src", "cli", "index.ts");

  import(jsEntry).catch((err) => {
    console.error("Failed to start CLI:", err);
    process.exit(1);
  });
}
