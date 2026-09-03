import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import {
  SkillsLoader,
  createSkillTool,
  MemoryStore,
  createRememberTool,
  ToolRouter,
  Session,
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
} from "../src";

const testTmpDir = resolve(import.meta.dir, "fixtures", "tmp_skills_memories");

class SkillsMemoriesMockModelClient extends ModelClient {
  public lastSystemPrompt = "";

  newSession(): ModelClientSession {
    return {
      stream: async function* (
        this: SkillsMemoriesMockModelClient,
        params: ModelSamplingParams
      ): AsyncIterable<StreamChunkEvent> {
        this.lastSystemPrompt = params.systemPrompt;
        yield { type: "text_delta", delta: "Skill & memory check completed." };
        yield { type: "done" };
      }.bind(this),
    };
  }
}

describe("Skills & Persistent Memory Subsystem", () => {
  beforeEach(() => {
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
    mkdirSync(testTmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  test("SkillsLoader discovers SKILL.md and parses frontmatter metadata", () => {
    const skillDir = join(testTmpDir, "deploy-guide");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: deploy-guide
description: "Step by step production deployment checklist."
---
# Production Deployment
1. Run \`bun test\`
2. Check environment secrets
3. Push to production
`,
      "utf8"
    );

    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    const skills = loader.listSkills(testTmpDir);

    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe("deploy-guide");
    expect(skills[0]?.description).toContain("production deployment");

    const loaded = loader.loadSkill(testTmpDir, "deploy-guide");
    expect(loaded).not.toBeNull();
    expect(loaded?.instructions).toContain("Run `bun test`");
  });

  test("SkillsLoader discovers zero built-in skills by default on fresh install", () => {
    const loader = new SkillsLoader({ includeGlobal: false, includeBuiltIn: true });
    const skills = loader.listSkills(process.cwd());
    expect(skills.length).toBe(0);
  });

  test("SkillsLoader supports disabling and re-enabling skills", () => {
    const skillDir = join(testTmpDir, "toggle-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: toggle-skill
description: Toggle test skill.
---
# Toggle Skill Instructions
Toggle logic check.
`,
      "utf8"
    );

    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    
    expect(loader.isSkillDisabled("toggle-skill")).toBe(false);
    
    // 1. Disable skill
    loader.disableSkill("toggle-skill");
    expect(loader.isSkillDisabled("toggle-skill")).toBe(true);

    const activeSkills = loader.listSkills(testTmpDir, { includeDisabled: false });
    expect(activeSkills.map((s) => s.name)).not.toContain("toggle-skill");

    // When disabled, loadSkill returns null
    expect(loader.loadSkill(testTmpDir, "toggle-skill")).toBeNull();

    // 2. Re-enable skill
    loader.enableSkill("toggle-skill");
    expect(loader.isSkillDisabled("toggle-skill")).toBe(false);
    expect(loader.loadSkill(testTmpDir, "toggle-skill")).not.toBeNull();
  });

  test("load_skill tool returns full skill instructions through ToolRouter", async () => {
    const skillDir = join(testTmpDir, "auth-pattern");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: auth-pattern
description: Authentication pattern implementation guide.
---
# Auth Guidelines
Always use JWT with HTTP-only cookies.
`,
      "utf8"
    );

    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    const router = new ToolRouter();
    router.register(createSkillTool(loader));

    expect(router.has("load_skill")).toBe(true);

    const result = await router.execute(
      "load_skill",
      { skill_name: "auth-pattern" },
      { cwd: testTmpDir, turnId: "turn_test" }
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Authentication pattern");
    expect(result.output).toContain("Always use JWT");
  });

  test("MemoryStore saves and synchronizes preferences in Markdown file", () => {
    const globalMemFile = join(testTmpDir, "global_memories.md");
    const workspaceMemFile = join(testTmpDir, "workspace_memories.md");

    const store = new MemoryStore({
      globalPath: globalMemFile,
      workspacePath: workspaceMemFile,
    });

    store.addMemory({
      category: "preference",
      content: "Always write code and documentation in English.",
      scope: "global",
      cwd: testTmpDir,
    });

    store.addMemory({
      category: "architecture",
      content: "Use bun:sqlite for local database persistence.",
      scope: "workspace",
      cwd: testTmpDir,
    });

    const memories = store.getAllMemories(testTmpDir);
    expect(memories.length).toBe(2);

    const globalMem = memories.find((m) => m.scope === "global");
    const wsMem = memories.find((m) => m.scope === "workspace");

    expect(globalMem?.content).toContain("English");
    expect(wsMem?.content).toContain("bun:sqlite");

    const promptText = store.formatMemoriesPrompt(testTmpDir);
    expect(promptText).toContain("English");
    expect(promptText).toContain("bun:sqlite");
  });

  test("remember tool allows LLM to record user preferences", async () => {
    const memDir = join(testTmpDir, "isolated_memory");
    const store = new MemoryStore({ workspacePath: memDir });
    const router = new ToolRouter();
    router.register(createRememberTool(store));

    expect(router.has("remember")).toBe(true);

    const result = await router.execute(
      "remember",
      { category: "preference", content: "User prefers functional programming with TaskEither." },
      { cwd: testTmpDir, turnId: "t1" }
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Successfully saved");

    const memories = store.getAllMemories(testTmpDir);
    expect(memories.length).toBe(1);
    expect(memories[0]?.content).toContain("TaskEither");
  });

  test("Session automatically injects skills and memories into model system prompt", async () => {
    const skillDir = join(testTmpDir, "refactor-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: refactor-skill
description: Guidelines for code refactoring.
---
# Refactor Instructions
Refactor surgically.
`,
      "utf8"
    );

    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false });
    const memFile = join(testTmpDir, "mem.md");
    const store = new MemoryStore({ globalPath: memFile });
    store.addMemory({
      category: "preference",
      content: "Do not use Tailwind unless requested.",
      scope: "global",
    });

    const mockClient = new SkillsMemoriesMockModelClient();
    const session = new Session({
      cwd: testTmpDir,
      skillsLoader: loader,
      memoryStore: store,
      modelClient: mockClient,
    });

    await session.promptAndWait("Check project architecture");

    expect(mockClient.lastSystemPrompt).toContain("Available Domain Skills");
    expect(mockClient.lastSystemPrompt).toContain("refactor-skill");
    expect(mockClient.lastSystemPrompt).toContain("Auto-Memory");
    expect(mockClient.lastSystemPrompt).toContain("Do not use Tailwind");
  });
});
