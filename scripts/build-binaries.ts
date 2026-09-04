/**
 * Build Script for Compiling Multi-Platform Standalone Binaries
 * Targets: Linux (x64, ARM64, glibc & musl), macOS (Intel, Apple Silicon), Windows (x64, ARM64)
 * Also packages standalone npm sub-packages for distribution via optionalDependencies.
 */

import { existsSync, mkdirSync, createReadStream, writeFileSync, copyFileSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_BIN_DIR = join(ROOT_DIR, "dist", "bin");
const RELEASE_DIR = join(ROOT_DIR, "dist", "release");
const PACKAGES_DIR = join(ROOT_DIR, "dist", "packages");

const pkgJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
const VERSION = pkgJson.version || "0.4.0";
const SCOPE = pkgJson.name.startsWith("@") ? pkgJson.name.split("/")[0] : "@pikaa-ai";

if (!existsSync(DIST_BIN_DIR)) {
  mkdirSync(DIST_BIN_DIR, { recursive: true });
}
if (!existsSync(RELEASE_DIR)) {
  mkdirSync(RELEASE_DIR, { recursive: true });
}
if (!existsSync(PACKAGES_DIR)) {
  mkdirSync(PACKAGES_DIR, { recursive: true });
}

export interface Target {
  name: string;
  bunTarget: string;
  outputFile: string;
  packageName: string;
  os: string;
  cpu: string;
  libc?: string;
  binaryName: string;
}

export const TARGETS: Target[] = [
  {
    name: "Linux x64 (glibc)",
    bunTarget: "bun-linux-x64",
    outputFile: "pikaa-linux-x64",
    packageName: "pikaa-linux-x64",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
    binaryName: "pikaa",
  },
  {
    name: "Linux x64 (musl / Alpine)",
    bunTarget: "bun-linux-x64-musl",
    outputFile: "pikaa-linux-x64-musl",
    packageName: "pikaa-linux-x64-musl",
    os: "linux",
    cpu: "x64",
    libc: "musl",
    binaryName: "pikaa",
  },
  {
    name: "Linux ARM64 (glibc)",
    bunTarget: "bun-linux-arm64",
    outputFile: "pikaa-linux-arm64",
    packageName: "pikaa-linux-arm64",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
    binaryName: "pikaa",
  },
  {
    name: "Linux ARM64 (musl / Alpine)",
    bunTarget: "bun-linux-arm64-musl",
    outputFile: "pikaa-linux-arm64-musl",
    packageName: "pikaa-linux-arm64-musl",
    os: "linux",
    cpu: "arm64",
    libc: "musl",
    binaryName: "pikaa",
  },
  {
    name: "macOS x64 (Intel)",
    bunTarget: "bun-darwin-x64",
    outputFile: "pikaa-darwin-x64",
    packageName: "pikaa-darwin-x64",
    os: "darwin",
    cpu: "x64",
    binaryName: "pikaa",
  },
  {
    name: "macOS ARM64 (Apple Silicon)",
    bunTarget: "bun-darwin-arm64",
    outputFile: "pikaa-darwin-arm64",
    packageName: "pikaa-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    binaryName: "pikaa",
  },
  {
    name: "Windows x64",
    bunTarget: "bun-windows-x64",
    outputFile: "pikaa-windows-x64.exe",
    packageName: "pikaa-windows-x64",
    os: "win32",
    cpu: "x64",
    binaryName: "pikaa.exe",
  },
  {
    name: "Windows ARM64",
    bunTarget: "bun-windows-arm64",
    outputFile: "pikaa-windows-arm64.exe",
    packageName: "pikaa-windows-arm64",
    os: "win32",
    cpu: "arm64",
    binaryName: "pikaa.exe",
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

function generatePlatformPackage(target: Target, binarySourcePath: string) {
  const pkgDir = join(PACKAGES_DIR, target.packageName);
  if (!existsSync(pkgDir)) {
    mkdirSync(pkgDir, { recursive: true });
  }

  const destBinary = join(pkgDir, target.binaryName);
  copyFileSync(binarySourcePath, destBinary);
  if (target.os !== "win32") {
    try { chmodSync(destBinary, 0o755); } catch {}
  }

  const fullPkgName = `${SCOPE}/${target.packageName}`;
  const manifest: Record<string, any> = {
    name: fullPkgName,
    version: VERSION,
    description: `${target.name} standalone native binary for PIKAA CLI`,
    license: "MIT",
    os: [target.os],
    cpu: [target.cpu],
    main: target.binaryName,
    bin: {
      [target.packageName]: target.binaryName,
    },
    files: [target.binaryName, "README.md"],
  };

  if (target.libc) {
    manifest.libc = [target.libc];
  }

  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(
    join(pkgDir, "README.md"),
    `# ${fullPkgName}\n\nPrecompiled standalone binary for PIKAA CLI on ${target.name}.\n`,
    "utf8"
  );
}

async function buildAll() {
  const args = process.argv.slice(2);
  let activeTargets = TARGETS;

  const targetArg = args.find((a) => a.startsWith("--target="));
  const onlyArg = args.find((a) => a.startsWith("--only="));
  if (targetArg) {
    const val = targetArg.split("=")[1];
    if (val) {
      activeTargets = TARGETS.filter((t) => t.bunTarget === val || t.outputFile === val);
    }
  } else if (onlyArg) {
    const val = onlyArg.split("=")[1];
    if (val) {
      const query = val.toLowerCase();
      activeTargets = TARGETS.filter((t) => t.packageName.includes(val) || t.name.toLowerCase().includes(query));
    }
  }

  console.log("==================================================");
  console.log(` 🚀 Building Multi-Platform Native Binaries (${activeTargets.length} targets)`);
  console.log("==================================================\n");

  const checksums: string[] = [];

  for (const target of activeTargets) {
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

      // Create platform npm package
      generatePlatformPackage(target, outPath);
      console.log(`   ✓ Generated NPM platform package: ${SCOPE}/${target.packageName}`);
    }
  }

  // Write SHA256SUMS.txt
  const checksumFile = join(RELEASE_DIR, "SHA256SUMS.txt");
  writeFileSync(checksumFile, checksums.join("\n") + "\n", "utf-8");

  console.log("\n==================================================");
  console.log(` ✅ Completed: ${activeTargets.length} Binaries & Platform Packages Ready!`);
  console.log(` 📦 Binaries directory: ${DIST_BIN_DIR}`);
  console.log(` 📦 Platform packages: ${PACKAGES_DIR}`);
  console.log(` 🔒 Checksums: ${checksumFile}`);
  console.log("==================================================\n");
}

if (import.meta.main) {
  buildAll().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
  });
}
