/**
 * Build Script for Compiling Multi-Platform Standalone Binaries
 * Targets: Linux (x64, ARM64), macOS (Intel, Apple Silicon), Windows (x64, ARM64)
 */

import { existsSync, mkdirSync, createReadStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_BIN_DIR = join(ROOT_DIR, "dist", "bin");
const RELEASE_DIR = join(ROOT_DIR, "dist", "release");

if (!existsSync(DIST_BIN_DIR)) {
  mkdirSync(DIST_BIN_DIR, { recursive: true });
}
if (!existsSync(RELEASE_DIR)) {
  mkdirSync(RELEASE_DIR, { recursive: true });
}

interface Target {
  name: string;
  bunTarget: string;
  outputFile: string;
  os: string;
  arch: string;
}

const TARGETS: Target[] = [
  {
    name: "Linux x64",
    bunTarget: "bun-linux-x64",
    outputFile: "pikaa-linux-x64",
    os: "linux",
    arch: "x64",
  },
  {
    name: "Linux ARM64",
    bunTarget: "bun-linux-arm64",
    outputFile: "pikaa-linux-arm64",
    os: "linux",
    arch: "arm64",
  },
  {
    name: "macOS x64 (Intel)",
    bunTarget: "bun-darwin-x64",
    outputFile: "pikaa-darwin-x64",
    os: "darwin",
    arch: "x64",
  },
  {
    name: "macOS ARM64 (Apple Silicon)",
    bunTarget: "bun-darwin-arm64",
    outputFile: "pikaa-darwin-arm64",
    os: "darwin",
    arch: "arm64",
  },
  {
    name: "Windows x64",
    bunTarget: "bun-windows-x64",
    outputFile: "pikaa-windows-x64.exe",
    os: "win32",
    arch: "x64",
  },
  {
    name: "Windows ARM64",
    bunTarget: "bun-windows-arm64",
    outputFile: "pikaa-windows-arm64.exe",
    os: "win32",
    arch: "arm64",
  },
];

async function calculateSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function buildAll() {
  console.log("==================================================");
  console.log(" 🚀 Building Multi-Platform Native Binaries");
  console.log("==================================================\n");

  const checksums: string[] = [];

  for (const target of TARGETS) {
    const outPath = join(DIST_BIN_DIR, target.outputFile);
    console.log(`🔨 Compiling [${target.name}] -> ${target.outputFile} ...`);

    const proc = Bun.spawn([
      "bun",
      "build",
      "./src/cli/index.ts",
      "--compile",
      `--target=${target.bunTarget}`,
      "--outfile",
      outPath,
    ], {
      cwd: ROOT_DIR,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.error(`❌ Failed to compile for ${target.name}`);
      process.exit(exitCode);
    }

    if (existsSync(outPath)) {
      const hash = await calculateSha256(outPath);
      checksums.push(`${hash}  ${target.outputFile}`);
      console.log(`   ✓ SHA256: ${hash}`);
    }
  }

  // Write SHA256SUMS.txt
  const checksumFile = join(RELEASE_DIR, "SHA256SUMS.txt");
  writeFileSync(checksumFile, checksums.join("\n") + "\n", "utf-8");

  console.log("\n==================================================");
  console.log(" ✅ All 6 Cross-Platform Binaries Compiled Successfully!");
  console.log(` 📦 Output directory: ${DIST_BIN_DIR}`);
  console.log(` 🔒 Checksums: ${checksumFile}`);
  console.log("==================================================\n");
}

buildAll().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
