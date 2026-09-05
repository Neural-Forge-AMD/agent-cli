/**
 * NPM Release Script for Multi-Platform Binary Packages
 * Publishes each platform sub-package, syncs optionalDependencies, and publishes the root wrapper package.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT_DIR = join(import.meta.dir, "..");
const PACKAGES_DIR = join(ROOT_DIR, "dist", "packages");
const PKG_PATH = join(ROOT_DIR, "package.json");

function exec(cmd: string, cwd: string = ROOT_DIR): void {
  console.log(`> (${cwd}) ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const dryFlag = isDryRun ? " --dry-run" : "";

  console.log("==================================================");
  console.log(` 🚀 Publishing Multi-Platform Packages to NPM ${isDryRun ? "[DRY-RUN]" : ""}`);
  console.log("==================================================\n");

  if (!existsSync(PACKAGES_DIR)) {
    console.error("❌ Directory dist/packages not found. Run 'bun run build:binaries' first.");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8").replace(/^\uFEFF/, ""));
  const version = pkg.version;
  const scope = pkg.name.startsWith("@") ? pkg.name.split("/")[0] : "@pikaa-ai";

  const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  console.log(`Found ${packageDirs.length} platform packages to publish:`);
  for (const dir of packageDirs) {
    console.log(` - ${dir}`);
  }
  console.log("");

  // 1. Publish each platform package
  for (const dir of packageDirs) {
    const fullDir = join(PACKAGES_DIR, dir);
    console.log(`📦 Publishing platform sub-package: ${dir}...`);
    try {
      exec(`npm publish --access public${dryFlag}`, fullDir);
      console.log(`   ✓ Published ${dir}\n`);
    } catch (err: any) {
      console.error(`❌ Failed to publish ${dir}:`, err.message);
      if (!isDryRun) {
        process.exit(1);
      }
    }
  }

  // 2. Sync optionalDependencies in root package.json
  console.log("🔄 Syncing optionalDependencies in root package.json...");
  pkg.optionalDependencies = pkg.optionalDependencies || {};

  for (const dir of packageDirs) {
    const fullPkgName = `${scope}/${dir}`;
    pkg.optionalDependencies[fullPkgName] = version;
  }

  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log(`✓ Updated root package.json optionalDependencies with version ${version}\n`);

  // 3. Publish the root package
  console.log(`📦 Publishing main package: ${pkg.name}@${version}...`);
  try {
    exec(`npm publish --access public${dryFlag}`, ROOT_DIR);
    console.log(`\n🎉 Successfully published ${pkg.name}@${version} and all platform packages!`);
  } catch (err: any) {
    console.error(`❌ Failed to publish ${pkg.name}:`, err.message);
    if (!isDryRun) {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Publish failed:", err);
  process.exit(1);
});
