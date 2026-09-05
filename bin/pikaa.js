#!/usr/bin/env node

/**
 * Universal Native Launcher for Pikaa Agent CLI.
 *
 * Automatically detects platform (macOS, Linux glibc/musl, Windows) and architecture (arm64, x64).
 * 1. Resolves and executes the precompiled platform binary from optionalDependencies (0ms startup, zero network).
 * 2. If running from local source, finds local dist/bin or compiles on the fly if Bun is present.
 * 3. If installed with --no-optional, falls back to downloading the standalone binary to ~/.pikaa/bin/.
 *
 * Zero external dependencies required. Does NOT require Bun or compilation tools for end-users.
 */

import { spawnSync } from "node:child_process";
import { existsSync, chmodSync, mkdirSync, createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import https from "node:https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const require = createRequire(import.meta.url);

const platform = process.platform;
const arch = process.arch;

let version = "";
let scope = "@pikaa-ai";
try {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8").replace(/^\uFEFF/, ""));
  version = pkg.version || "";
  if (pkg.name && pkg.name.startsWith("@")) {
    scope = pkg.name.split("/")[0];
  }
} catch {}

/**
 * Check if the current Linux system uses musl libc (e.g. Alpine Linux)
 */
export function isMusl() {
  if (platform !== "linux") return false;
  try {
    if (existsSync("/etc/alpine-release")) return true;
    const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" });
    const text = (ldd.stdout || "") + (ldd.stderr || "");
    if (text.toLowerCase().includes("musl")) return true;
  } catch {}
  return false;
}

/**
 * Get the platform-specific sub-package information
 */
export function getPlatformPackageInfo(customScope = scope) {
  const isWindows = platform === "win32";
  const binaryFile = isWindows ? "pikaa.exe" : "pikaa";

  if (platform === "win32") {
    if (arch === "arm64") {
      return { pkg: `${customScope}/pikaa-windows-arm64`, binary: binaryFile, releaseFile: "pikaa-windows-arm64.exe", fallbackPkg: null };
    }
    return { pkg: `${customScope}/pikaa-windows-x64`, binary: binaryFile, releaseFile: "pikaa-windows-x64.exe", fallbackPkg: null };
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return { pkg: `${customScope}/pikaa-darwin-arm64`, binary: binaryFile, releaseFile: "pikaa-darwin-arm64", fallbackPkg: null };
    }
    return { pkg: `${customScope}/pikaa-darwin-x64`, binary: binaryFile, releaseFile: "pikaa-darwin-x64", fallbackPkg: null };
  }

  if (platform === "linux") {
    const musl = isMusl();
    if (arch === "arm64") {
      return musl
        ? { pkg: `${customScope}/pikaa-linux-arm64-musl`, binary: binaryFile, releaseFile: "pikaa-linux-arm64-musl", fallbackPkg: `${customScope}/pikaa-linux-arm64` }
        : { pkg: `${customScope}/pikaa-linux-arm64`, binary: binaryFile, releaseFile: "pikaa-linux-arm64", fallbackPkg: `${customScope}/pikaa-linux-arm64-musl` };
    }
    return musl
      ? { pkg: `${customScope}/pikaa-linux-x64-musl`, binary: binaryFile, releaseFile: "pikaa-linux-x64-musl", fallbackPkg: `${customScope}/pikaa-linux-x64` }
      : { pkg: `${customScope}/pikaa-linux-x64`, binary: binaryFile, releaseFile: "pikaa-linux-x64", fallbackPkg: `${customScope}/pikaa-linux-x64-musl` };
  }

  return null;
}

const platformInfo = getPlatformPackageInfo();
const userBinDir = join(homedir(), ".pikaa", "bin");
const userBinaryPath = platformInfo && version ? join(userBinDir, `pikaa-v${version}-${platformInfo.releaseFile}`) : null;

/**
 * 1. Locate the native binary installed from optionalDependencies
 */
function findPlatformPackageBinary() {
  if (!platformInfo) return null;

  const candidates = [platformInfo.pkg, platformInfo.fallbackPkg].filter(Boolean);

  for (const pkgName of candidates) {
    // A. Resolve through Node.js require.resolve
    try {
      const resolved = require.resolve(pkgName);
      if (resolved && existsSync(resolved)) return resolved;
    } catch {}

    // B. Direct check in node_modules (local or hoisted)
    const relativePaths = [
      join(rootDir, "node_modules", pkgName, platformInfo.binary),
      join(rootDir, "..", pkgName.replace(`${scope}/`, ""), platformInfo.binary),
      join(rootDir, "..", pkgName, platformInfo.binary),
      join(rootDir, "dist", "packages", pkgName.replace(`${scope}/`, ""), platformInfo.binary),
    ];

    for (const p of relativePaths) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}

/**
 * 2. Locate existing local or cached binary
 */
function findExistingBinary() {
  if (!platformInfo) return null;
  const candidates = [
    join(rootDir, "pikaa.exe"),
    join(rootDir, "bin", platformInfo.releaseFile),
    join(rootDir, "dist", "bin", platformInfo.releaseFile),
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
  const tsEntry = join(rootDir, "src", "cli", "index.ts");
  const targetEntry = existsSync(jsEntry) ? jsEntry : (existsSync(tsEntry) ? tsEntry : null);

  if (targetEntry) {
    const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
    if (!probe.error) {
      const r = spawnSync("bun", ["run", targetEntry, ...process.argv.slice(2)], {
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
  // 1. Primary: Use pre-installed native platform binary from optionalDependencies (0ms startup)
  const platformBin = findPlatformPackageBinary();
  if (platformBin) {
    launchBinary(platformBin);
    return;
  }

  // 2. Secondary: Use local or cached standalone binary
  const existing = findExistingBinary();
  if (existing) {
    launchBinary(existing);
    return;
  }

  // 3. Tertiary: If developing locally with Bun installed, run dist/cli.js
  if (tryLaunchWithBun()) {
    return;
  }

  if (!platformInfo || !userBinaryPath) {
    console.error(`\x1b[31m[pikaa] Error: Unsupported platform/architecture: ${platform}/${arch}\x1b[0m`);
    process.exit(1);
  }

  // 4. Fallback: Download standalone binary from GitHub release (e.g. if installed with --no-optional)
  const downloadUrl = `https://github.com/Neural-Forge-AMD/agent-cli/releases/download/v${version}/${platformInfo.releaseFile}`;

  try {
    mkdirSync(userBinDir, { recursive: true });
    process.stderr.write(`\x1b[36m⚡ [pikaa] Downloading native binary v${version} for ${platform}/${arch}...\x1b[0m\n`);
    await downloadBinary(downloadUrl, userBinaryPath);
    if (platform !== "win32") {
      chmodSync(userBinaryPath, 0o755);
    }
    process.stderr.write(`\x1b[32m✓ Setup complete!\x1b[0m\n\n`);
    launchBinary(userBinaryPath);
  } catch (err) {
    process.stderr.write(`\x1b[33m[pikaa] Warning: Failed to download native binary: ${err.message}\x1b[0m\n`);

    console.error(`\n\x1b[31m[pikaa] Could not find or download native executable for ${platform}/${arch}.\x1b[0m`);
    console.error(`Please reinstall with optional dependencies:`);
    console.error(`  npm install -g ${scope}/pikaa\n`);
    process.exit(1);
  }
}

const isDirectCall = process.argv[1] && (
  process.argv[1].endsWith("pikaa.js") ||
  process.argv[1].endsWith("pikaa") ||
  process.argv[1].endsWith("groupy")
);

if (isDirectCall) {
  main();
}
