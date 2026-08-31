#!/usr/bin/env node

/**
 * Universal Native Launcher for Pikaa Agent CLI.
 *
 * Automatically detects platform (macOS, Linux, Windows) and architecture (arm64, x64).
 * If the native binary is already present, runs it with 0ms startup time.
 * If not present (e.g. postinstall script skipped by npm allow-scripts), automatically
 * downloads the native binary from GitHub Releases to ~/.pikaa/bin/ and executes it.
 *
 * Zero external dependencies required. Does NOT require Bun or compilation tools.
 */

import { spawnSync } from "node:child_process";
import { existsSync, chmodSync, mkdirSync, createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { pipeline } from "node:stream/promises";
import https from "node:https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const platform = process.platform;
const arch = process.arch;

let version = "0.2.3";
try {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  version = pkg.version;
} catch {}

function getBinaryName() {
  if (platform === "win32") return arch === "arm64" ? "pikaa-windows-arm64.exe" : "pikaa-windows-x64.exe";
  if (platform === "darwin") return arch === "arm64" ? "pikaa-darwin-arm64" : "pikaa-darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "pikaa-linux-arm64" : "pikaa-linux-x64";
  return null;
}

const binaryName = getBinaryName();
const userBinDir = join(homedir(), ".pikaa", "bin");
const userBinaryPath = binaryName ? join(userBinDir, `pikaa-v${version}-${binaryName}`) : null;

// Look in package directory or user cache directory
function findExistingBinary() {
  if (!binaryName) return null;
  const candidates = [
    join(rootDir, "pikaa.exe"),
    join(rootDir, "bin", binaryName),
    join(rootDir, "dist", "bin", binaryName),
    userBinaryPath,
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function launchBinary(binPath) {
  if (platform !== "win32") {
    try { chmodSync(binPath, 0o755); } catch {}
  }
  const r = spawnSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status ?? (r.error ? 1 : 0));
}

function tryLaunchWithBun() {
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
  return false;
}

async function downloadBinary(url, dest, redirects = 0) {
  if (redirects > 5) throw new Error("Too many redirects");

  await new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "pikaa-cli-launcher" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        resolve(downloadBinary(res.headers.location, dest, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      pipeline(res, file).then(resolve).catch(reject);
    }).on("error", reject);
  });
}

async function main() {
  // 1. If local bun and dist/cli.js are available in the package, run immediately
  if (tryLaunchWithBun()) {
    return;
  }

  // 2. Otherwise use existing native binary if present
  const existing = findExistingBinary();
  if (existing) {
    launchBinary(existing);
    return;
  }

  if (!binaryName || !userBinaryPath) {
    console.error(`[pikaa] Platform not supported: ${platform}/${arch}`);
    process.exit(1);
  }

  const downloadUrl = `https://github.com/Neural-Forge-AMD/agent-cli/releases/download/v${version}/${binaryName}`;

  try {
    mkdirSync(userBinDir, { recursive: true });
    process.stderr.write(`\x1b[36m⚡ [pikaa] First-time setup: Downloading native binary v${version} for ${platform}/${arch}...\x1b[0m\n`);
    await downloadBinary(downloadUrl, userBinaryPath);
    if (platform !== "win32") {
      chmodSync(userBinaryPath, 0o755);
    }
    process.stderr.write(`\x1b[32m✓ Setup complete!\x1b[0m\n\n`);
    launchBinary(userBinaryPath);
  } catch (err) {
    process.stderr.write(`\x1b[33mWarning: Failed to download native binary: ${err.message}\x1b[0m\n`);

    if (tryLaunchWithBun()) {
      return;
    }

    console.error(`\nPlease check your internet connection or install Bun (https://bun.sh) and retry.`);
    process.exit(1);
  }
}

main();
