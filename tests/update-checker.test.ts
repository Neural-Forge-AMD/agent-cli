import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSemver,
  isNewerVersion,
  checkForUpdates,
  type UpdateCacheData,
} from "../src/cli/update-checker";
import { CliFormatter } from "../src/cli/ui/formatter";

describe("CLI Version Update Notification Subsystem", () => {
  let testCacheDir: string;
  let testCacheFile: string;

  beforeEach(() => {
    testCacheDir = join(tmpdir(), `pikaa_update_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(testCacheDir, { recursive: true });
    testCacheFile = join(testCacheDir, "update-cache.json");
  });

  afterEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  it("should parse semver accurately", () => {
    expect(parseSemver("v0.2.5")).toEqual([0, 2, 5]);
    expect(parseSemver("1.10.3")).toEqual([1, 10, 3]);
    expect(parseSemver("2.0")).toEqual([2, 0, 0]);
  });

  it("should compare version precedence correctly", () => {
    expect(isNewerVersion("0.2.5", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.2.5", "1.0.0")).toBe(true);
    expect(isNewerVersion("0.2.5", "0.2.6")).toBe(true);

    expect(isNewerVersion("0.2.5", "0.2.5")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.2.5")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);
  });

  it("should return update info when cache contains newer version", async () => {
    const mockCache: UpdateCacheData = {
      lastChecked: Date.now(), // fresh within 12h
      latestVersion: "0.3.0",
      packageName: "@pikaa-ai/pikaa",
    };
    writeFileSync(testCacheFile, JSON.stringify(mockCache), "utf8");

    const result = await checkForUpdates({
      currentVersion: "0.2.5",
      packageName: "@pikaa-ai/pikaa",
      cachePath: testCacheFile,
    });

    expect(result).not.toBeNull();
    expect(result?.updateAvailable).toBe(true);
    expect(result?.latestVersion).toBe("0.3.0");
    expect(result?.currentVersion).toBe("0.2.5");
  });

  it("should return null when cache indicates current version is up to date", async () => {
    const mockCache: UpdateCacheData = {
      lastChecked: Date.now(),
      latestVersion: "0.2.5",
      packageName: "@pikaa-ai/pikaa",
    };
    writeFileSync(testCacheFile, JSON.stringify(mockCache), "utf8");

    const result = await checkForUpdates({
      currentVersion: "0.2.5",
      packageName: "@pikaa-ai/pikaa",
      cachePath: testCacheFile,
    });

    expect(result).toBeNull();
  });

  it("should render update announcement card cleanly in CliFormatter", () => {
    let captured = "";
    const orig = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(" ") + "\n";
    };

    try {
      CliFormatter.printUpdateNotice({
        currentVersion: "0.2.5",
        latestVersion: "0.3.0",
        packageName: "@pikaa-ai/pikaa",
      });

      expect(captured).toContain("Update available");
      expect(captured).toContain("v0.2.5");
      expect(captured).toContain("v0.3.0");
      expect(captured).toContain("bun add -g @pikaa-ai/pikaa");
      expect(captured).toContain("npm i -g @pikaa-ai/pikaa");
    } finally {
      console.log = orig;
    }
  });

  it("should respect PIKAA_NO_UPDATE_CHECK=1 disable flag", async () => {
    const prev = process.env.PIKAA_NO_UPDATE_CHECK;
    process.env.PIKAA_NO_UPDATE_CHECK = "1";
    try {
      const mockCache: UpdateCacheData = {
        lastChecked: Date.now(),
        latestVersion: "0.3.0",
        packageName: "@pikaa-ai/pikaa",
      };
      writeFileSync(testCacheFile, JSON.stringify(mockCache), "utf8");

      const result = await checkForUpdates({
        currentVersion: "0.2.5",
        packageName: "@pikaa-ai/pikaa",
        cachePath: testCacheFile,
      });

      expect(result).toBeNull();
    } finally {
      if (prev === undefined) {
        delete process.env.PIKAA_NO_UPDATE_CHECK;
      } else {
        process.env.PIKAA_NO_UPDATE_CHECK = prev;
      }
    }
  });
});
