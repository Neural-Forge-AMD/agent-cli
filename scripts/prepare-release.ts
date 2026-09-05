/**
 * Automatic Release & Version Tagging Script
 * Used by CI/CD pipeline on push/merge to main branch.
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const rootDir = join(import.meta.dir, "..");
const pkgPath = join(rootDir, "package.json");

function exec(cmd: string): string {
  try {
    return execSync(cmd, { cwd: rootDir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`Command failed: ${cmd}\nError: ${stderr}`);
  }
}

function runSilent(cmd: string): boolean {
  try {
    execSync(cmd, { cwd: rootDir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("==================================================");
  console.log(" 📦 CI/CD Auto-Version & Release Resolver");
  console.log("==================================================\n");

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
  let currentVersion: string = pkg.version || "0.3.0";

  const githubRef = process.env.GITHUB_REF || "";
  const isTagTrigger = githubRef.startsWith("refs/tags/v");

  if (isTagTrigger) {
    const tagVersion = githubRef.replace("refs/tags/v", "");
    console.log(`📌 Triggered directly by tag: v${tagVersion}`);
    if (pkg.version !== tagVersion) {
      pkg.version = tagVersion;
      if (pkg.optionalDependencies) {
        for (const k of Object.keys(pkg.optionalDependencies)) {
          pkg.optionalDependencies[k] = tagVersion;
        }
      }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      console.log(`✓ Synced package.json version to ${tagVersion}`);
    }
    setOutputs(tagVersion, `v${tagVersion}`);
    return;
  }

  // Fetch all tags from origin
  console.log("🔍 Fetching remote tags...");
  runSilent("git fetch --tags origin");

  const existingTags = exec("git tag -l").split("\n").map((t) => t.trim()).filter(Boolean);
  console.log(`Found ${existingTags.length} existing tags.`);

  let targetVersion = currentVersion;
  const tagToCheck = `v${currentVersion}`;

  if (existingTags.includes(tagToCheck)) {
    console.log(`⚠️  Tag ${tagToCheck} already exists on remote.`);
    console.log("⚡ Auto-incrementing patch version...");

    const parts = currentVersion.split(".").map((n) => parseInt(n, 10));
    if (parts.length === 3 && !parts.some(isNaN)) {
      parts[2] += 1;
      targetVersion = parts.join(".");
    } else {
      targetVersion = `${currentVersion}-patch.1`;
    }

    console.log(`📈 New version: ${targetVersion}`);
    pkg.version = targetVersion;
    if (pkg.optionalDependencies) {
      for (const k of Object.keys(pkg.optionalDependencies)) {
        pkg.optionalDependencies[k] = targetVersion;
      }
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

    // Commit and push the bumped version
    console.log("📝 Committing version bump to main...");
    exec(`git commit -am "chore(release): bump version to v${targetVersion} [skip ci]"`);
    exec("git push origin HEAD:main");
  } else {
    console.log(`✓ Version ${currentVersion} has no existing tag. Releasing v${currentVersion}...`);
  }

  const releaseTag = `v${targetVersion}`;

  // Create and push the annotated tag
  console.log(`🏷️  Creating git tag ${releaseTag}...`);
  exec(`git tag -a "${releaseTag}" -m "Release ${releaseTag}"`);
  
  console.log(`🚀 Pushing tag ${releaseTag} to origin...`);
  exec(`git push origin "${releaseTag}"`);

  setOutputs(targetVersion, releaseTag);
}

function setOutputs(version: string, tag: string) {
  console.log("\n==================================================");
  console.log(` ✅ Target Release: ${tag} (${version})`);
  console.log("==================================================\n");

  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(githubEnv, `RELEASE_VERSION=${version}\nRELEASE_TAG=${tag}\n`);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `version=${version}\ntag=${tag}\n`);
  }
}

main().catch((err) => {
  console.error("❌ Release preparation failed:", err);
  process.exit(1);
});
