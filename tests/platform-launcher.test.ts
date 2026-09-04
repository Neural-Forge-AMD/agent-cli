import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { TARGETS } from "../scripts/build-binaries";
// @ts-expect-error bin/pikaa.js is a plain JavaScript launcher file without type definitions
import { getPlatformPackageInfo } from "../bin/pikaa.js";

const ROOT_DIR = join(import.meta.dir, "..");

describe("Platform Launcher & Cross-Platform Distribution", () => {
  it("should define all 8 required OS & architecture targets in build matrix", () => {
    expect(TARGETS.length).toBe(8);

    const targetNames = TARGETS.map((t) => t.packageName);
    expect(targetNames).toContain("pikaa-linux-x64");
    expect(targetNames).toContain("pikaa-linux-x64-musl");
    expect(targetNames).toContain("pikaa-linux-arm64");
    expect(targetNames).toContain("pikaa-linux-arm64-musl");
    expect(targetNames).toContain("pikaa-darwin-x64");
    expect(targetNames).toContain("pikaa-darwin-arm64");
    expect(targetNames).toContain("pikaa-windows-x64");
    expect(targetNames).toContain("pikaa-windows-arm64");
  });

  it("should match all 8 platform packages in root package.json optionalDependencies", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
    const optDeps = pkg.optionalDependencies || {};

    for (const target of TARGETS) {
      const fullPkgName = `@pikaa-ai/${target.packageName}`;
      expect(optDeps[fullPkgName]).toBeDefined();
      expect(optDeps[fullPkgName]).toBe(pkg.version);
    }
  });

  it("should resolve correct platform package info for current host system", () => {
    const info = getPlatformPackageInfo("@pikaa-ai");
    expect(info).not.toBeNull();
    expect(info?.pkg).toContain("@pikaa-ai/pikaa-");
    expect(info?.binary).toBe(process.platform === "win32" ? "pikaa.exe" : "pikaa");
  });

  it("should execute launcher using pure Node.js without requiring bun in launcher path", () => {
    const proc = spawnSync("node", ["bin/pikaa.js", "--version"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    });

    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("pikaa v");
  });
});
