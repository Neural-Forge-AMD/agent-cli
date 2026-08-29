#!/usr/bin/env node

/**
 * Postinstall: downloads the correct precompiled pikaa binary from GitHub Releases.
 * Runs automatically after `npm install -g @pikaa-ai/pikaa`.
 * Uses only Node.js built-ins — no Bun required.
 */

import { createWriteStream, chmodSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import https from "node:https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const pkg = JSON.parse(
  await import("node:fs").then((fs) =>
    fs.readFileSync(join(rootDir, "package.json"), "utf8")
  )
);
const version = pkg.version;
const REPO = "Neural-Forge-AMD/agent-cli";

function getBinaryName() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32") return arch === "arm64" ? "pikaa-windows-arm64.exe" : "pikaa-windows-x64.exe";
  if (platform === "darwin") return arch === "arm64" ? "pikaa-darwin-arm64" : "pikaa-darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "pikaa-linux-arm64" : "pikaa-linux-x64";
  return null;
}

const binaryName = getBinaryName();

if (!binaryName) {
  console.warn(`[pikaa] Unsupported platform: ${process.platform}/${process.arch}. Fallback to bun required.`);
  process.exit(0);
}

const binDir = join(rootDir, "bin");
const destPath = join(binDir, binaryName);

if (existsSync(destPath)) {
  // Already downloaded (e.g. cached by npm)
  process.exit(0);
}

mkdirSync(binDir, { recursive: true });

const url = `https://github.com/${REPO}/releases/download/v${version}/${binaryName}`;

console.log(`[pikaa] Downloading binary for ${process.platform}/${process.arch}...`);
console.log(`[pikaa] ${url}`);

async function download(downloadUrl, dest, redirects = 0) {
  if (redirects > 5) throw new Error("Too many redirects");

  await new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(downloadUrl, { headers: { "User-Agent": "pikaa-postinstall" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        resolve(download(res.headers.location, dest, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} from ${downloadUrl}`));
        return;
      }
      pipeline(res, file).then(resolve).catch(reject);
    }).on("error", reject);
  });
}

try {
  await download(url, destPath);
  if (process.platform !== "win32") {
    chmodSync(destPath, 0o755);
  }
  console.log(`[pikaa] ✓ Binary installed: ${destPath}`);
} catch (err) {
  // Non-fatal: user can still run via bun if installed
  console.warn(`[pikaa] Warning: could not download binary (${err.message})`);
  console.warn(`[pikaa] You can install Bun as a fallback: https://bun.sh/install`);
}
