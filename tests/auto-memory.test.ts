import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../src/memories/store";
import {
  createSaveMemoryTool,
  createReadMemoryTool,
  createListMemoriesTool,
  createRememberTool,
} from "../src/memories/tool";
import { ToolRouter } from "../src/tools/router";

describe("Claude Code-Grade Auto-Memory Subsystem", () => {
  let testWorkspace: string;
  let store: MemoryStore;

  beforeEach(() => {
    testWorkspace = join(tmpdir(), `pikaa-memory-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testWorkspace, { recursive: true });
    store = new MemoryStore();
  });

  afterEach(() => {
    if (existsSync(testWorkspace)) {
      try {
        rmSync(testWorkspace, { recursive: true, force: true });
      } catch {}
    }
  });

  it("computes deterministic project slug and memory directory", () => {
    const slug = store.getProjectSlug(testWorkspace);
    expect(slug).toBeDefined();
    expect(slug.length).toBeGreaterThan(5);

    const memoryDir = store.getProjectMemoryDir(testWorkspace);
    expect(existsSync(memoryDir)).toBe(true);
    expect(store.getMemoryIndexPath(testWorkspace)).toBe(join(memoryDir, "MEMORY.md"));
  });

  it("saves topic memory files with YAML frontmatter and syncs MEMORY.md index", () => {
    const entry = store.saveTopicMemory({
      category: "feedback",
      name: "testing_guidelines",
      description: "Do not mock database in integration tests",
      content: "Always use real in-memory SQLite instances when running integration tests.",
      cwd: testWorkspace,
    });

    expect(entry.category).toBe("feedback");
    expect(entry.name).toBe("testing_guidelines");
    expect(entry.filePath).toBeDefined();
    expect(existsSync(entry.filePath!)).toBe(true);

    const fileContent = readFileSync(entry.filePath!, "utf8");
    expect(fileContent).toContain("type: feedback");
    expect(fileContent).toContain("name: testing_guidelines");
    expect(fileContent).toContain("description: Do not mock database in integration tests");
    expect(fileContent).toContain("modified:");
    expect(fileContent).toContain("Always use real in-memory SQLite");

    // Verify MEMORY.md was generated and contains one-line index entry
    const indexContent = store.loadMemoryIndex(testWorkspace);
    expect(indexContent).toContain("# Project Auto-Memory Index");
    expect(indexContent).toContain("[feedback] **testing_guidelines**: Do not mock database in integration tests");
  });

  it("reads topic memory on-demand", () => {
    store.saveTopicMemory({
      category: "user",
      name: "stack_preferences",
      description: "User preferred libraries",
      content: "User prefers Tailwind CSS v4 and Bun test runner.",
      cwd: testWorkspace,
    });

    const topic = store.readTopicMemory("stack_preferences", testWorkspace);
    expect(topic).not.toBeNull();
    expect(topic?.type).toBe("user");
    expect(topic?.name).toBe("stack_preferences");
    expect(topic?.content).toContain("User prefers Tailwind CSS v4");
  });

  it("formats persistent Auto-Memory into system prompt", () => {
    store.saveTopicMemory({
      category: "project",
      name: "staging_environment",
      description: "Staging API endpoints",
      content: "Staging API baseUrl is https://api-staging.example.com/v1.",
      cwd: testWorkspace,
    });

    const promptSection = store.formatMemoriesPrompt(testWorkspace);
    expect(promptSection).toContain("## Project Auto-Memory (Persistent Learnings)");
    expect(promptSection).toContain("<auto_memory>");
    expect(promptSection).toContain("[project] **staging_environment**");
    expect(promptSection).toContain("</auto_memory>");
  });

  it("executes save_memory, read_memory, and list_memories tools via ToolRouter", async () => {
    const router = new ToolRouter();
    router.register(createSaveMemoryTool(store));
    router.register(createReadMemoryTool(store));
    router.register(createListMemoriesTool(store));
    router.register(createRememberTool(store));

    // 1. save_memory
    const saveRes = await router.execute(
      "save_memory",
      {
        category: "reference",
        name: "issue_tracker",
        description: "Linear issue tracker URL",
        content: "Linear workspace is at https://linear.app/my-team",
      },
      { cwd: testWorkspace } as any
    );
    expect(saveRes.isError).toBeFalsy();
    expect(saveRes.output).toContain("Saved Auto-Memory topic: [reference] \"issue_tracker\"");

    // 2. list_memories
    const listRes = await router.execute("list_memories", {}, { cwd: testWorkspace } as any);
    expect(listRes.output).toContain("issue_tracker");

    // 3. read_memory
    const readRes = await router.execute(
      "read_memory",
      { topic: "issue_tracker" },
      { cwd: testWorkspace } as any
    );
    expect(readRes.output).toContain("https://linear.app/my-team");

    // 4. remember (backward compatibility)
    const rememberRes = await router.execute(
      "remember",
      { category: "user", content: "Always use pnpm" },
      { cwd: testWorkspace } as any
    );
    expect(rememberRes.output).toContain("Successfully saved to Auto-Memory bank");
  });
});
