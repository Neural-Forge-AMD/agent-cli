import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { installSkill, removeSkill } from "../src/skills/installer";

const testTmpDir = resolve(import.meta.dir, "fixtures", "tmp_skill_installer");

describe("Skill Installer Subsystem", () => {
  let mockServer: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
    mkdirSync(testTmpDir, { recursive: true });

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/skills/fastapi-pro") {
          return Response.json({
            name: "fastapi-pro",
            title: "FastAPI Pro Expert",
            description: "Production guidelines for FastAPI.",
            content: "# FastAPI Guidelines\nAlways use Pydantic v2 models.",
            category: "Development",
            is_active: true,
          });
        }
        if (url.pathname === "/api/skills/missing-skill") {
          return new Response("Not Found", { status: 404 });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
  });

  afterEach(() => {
    if (mockServer) {
      mockServer.stop();
    }
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  test("installSkill fetches from backend and writes to .agents/skills/<name>/SKILL.md", async () => {
    const result = await installSkill("fastapi-pro", {
      cwd: testTmpDir,
      backendUrl: mockServer.url.origin,
    });

    expect(result.success).toBe(true);
    expect(result.skillName).toBe("fastapi-pro");
    expect(result.scope).toBe("workspace");

    const expectedPath = join(testTmpDir, ".agents", "skills", "fastapi-pro", "SKILL.md");
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, "utf-8");
    expect(content).toContain("name: fastapi-pro");
    expect(content).toContain("description: \"Production guidelines for FastAPI.\"");
    expect(content).toContain("# FastAPI Guidelines");
  });

  test("removeSkill deletes installed skill folder", async () => {
    // 1. Install skill
    await installSkill("fastapi-pro", {
      cwd: testTmpDir,
      backendUrl: mockServer.url.origin,
    });

    const expectedDir = join(testTmpDir, ".agents", "skills", "fastapi-pro");
    expect(existsSync(expectedDir)).toBe(true);

    // 2. Remove skill
    const removeResult = removeSkill("fastapi-pro", { cwd: testTmpDir });
    expect(removeResult.success).toBe(true);
    expect(removeResult.removed).toBe(true);
    expect(existsSync(expectedDir)).toBe(false);
  });

  test("installSkill rejects 404 missing skills cleanly", async () => {
    expect(
      installSkill("missing-skill", {
        cwd: testTmpDir,
        backendUrl: mockServer.url.origin,
      })
    ).rejects.toThrow("Skill 'missing-skill' not found in catalog");
  });

  test("installSkill rejects empty skill name", async () => {
    expect(
      installSkill("", {
        cwd: testTmpDir,
        backendUrl: mockServer.url.origin,
      })
    ).rejects.toThrow("Skill name cannot be empty.");
  });
});
