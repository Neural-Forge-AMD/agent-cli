import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getPikaaHomeDir,
  getCredentialsPath,
  getThreadsDbPath,
  getPrefixRulesDbPath,
  getAgentGraphDbPath,
  getGlobalSkillsDir,
  getGlobalMemoriesPath,
  getProjectsDir,
  ensurePikaaHomeMigrated,
} from "../src/config/paths";

describe("Centralized Path Configuration & Auto-Migration Subsystem", () => {
  const originalPikaaHome = process.env.PIKAA_HOME;
  const originalGroupyHome = process.env.GROUPY_HOME;
  let testPikaaHome: string;

  beforeEach(() => {
    testPikaaHome = join(tmpdir(), `pikaa-test-home-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    process.env.PIKAA_HOME = testPikaaHome;
  });

  afterEach(() => {
    if (originalPikaaHome !== undefined) {
      process.env.PIKAA_HOME = originalPikaaHome;
    } else {
      delete process.env.PIKAA_HOME;
    }

    if (originalGroupyHome !== undefined) {
      process.env.GROUPY_HOME = originalGroupyHome;
    } else {
      delete process.env.GROUPY_HOME;
    }

    if (existsSync(testPikaaHome)) {
      try {
        rmSync(testPikaaHome, { recursive: true, force: true });
      } catch {}
    }
  });

  it("resolves canonical paths relative to PIKAA_HOME", () => {
    expect(getPikaaHomeDir()).toBe(testPikaaHome);
    expect(getCredentialsPath()).toBe(join(testPikaaHome, "credentials.json"));
    expect(getThreadsDbPath()).toBe(join(testPikaaHome, "pikaa_threads.db"));
    expect(getPrefixRulesDbPath()).toBe(join(testPikaaHome, "pikaa_rules.db"));
    expect(getAgentGraphDbPath()).toBe(join(testPikaaHome, "agent_graph.db"));
    expect(getGlobalSkillsDir()).toBe(join(testPikaaHome, "skills"));
    expect(getGlobalMemoriesPath()).toBe(join(testPikaaHome, "memories.md"));
    expect(getProjectsDir()).toBe(join(testPikaaHome, "projects"));
  });

  it("creates destination directory on initialization", () => {
    ensurePikaaHomeMigrated();
    expect(existsSync(testPikaaHome)).toBe(true);
  });

  it("migrates legacy credentials and files cleanly", () => {
    const legacyHome = join(tmpdir(), `groupy-legacy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(legacyHome, { recursive: true });
    writeFileSync(join(legacyHome, "credentials.json"), JSON.stringify({ accessToken: "legacy-jwt-123" }), "utf8");

    // Point legacy to this directory
    process.env.GROUPY_HOME = legacyHome;
    ensurePikaaHomeMigrated(true);

    const migratedCreds = join(testPikaaHome, "credentials.json");
    expect(existsSync(migratedCreds)).toBe(true);
    expect(JSON.parse(readFileSync(migratedCreds, "utf8")).accessToken).toBe("legacy-jwt-123");

    rmSync(legacyHome, { recursive: true, force: true });
  });
});
