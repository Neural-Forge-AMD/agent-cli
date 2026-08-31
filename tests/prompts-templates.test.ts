import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PromptTemplateLoader } from "../src/prompts/loader";
import { AgentsMdLoader } from "../src/prompts/agents-md";
import { buildSystemPrompt } from "../src/context/instructions";

describe("Prompt Templates & AGENTS.md Subsystem", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `groupy-prompt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("PromptTemplateLoader", () => {
    it("should load built-in default mode template", () => {
      const loader = new PromptTemplateLoader();
      const content = loader.loadTemplate("modes/default.md", {
        KNOWN_MODE_NAMES: "default, plan, review",
      });

      expect(content).toContain("# Collaboration Mode: Default");
      expect(content).toContain("Known mode names are default, plan, review.");
    });

    it("should load built-in plan mode template", () => {
      const loader = new PromptTemplateLoader();
      const content = loader.loadTemplate("modes/plan.md");

      expect(content).toContain("# Plan Mode (Conversational)");
      expect(content).toContain("PHASE 1 — Ground in the environment");
      expect(content).toContain("<proposed_plan>");
    });

    it("should load built-in review mode rubric template", () => {
      const loader = new PromptTemplateLoader();
      const content = loader.loadTemplate("modes/review.md");

      expect(content).toContain("# Review guidelines:");
      expect(content).toContain("[P0] – Drop everything to fix");
    });

    it("should load base prompt, personality, and orchestrator templates", () => {
      const loader = new PromptTemplateLoader();
      const base = loader.loadTemplate("base/groupy_prompt.md");
      expect(base).toContain("You are Groupy, an expert autonomous AI coding assistant");
      expect(base).toContain("## Editing constraints");
      expect(base).toContain("destructive commands like `git reset --hard`");

      const pragmatic = loader.loadTemplate("personalities/pragmatic.md");
      expect(pragmatic).toContain("deeply pragmatic, effective software engineer");

      const friendly = loader.loadTemplate("personalities/friendly.md");
      expect(friendly).toContain("optimize for team morale");

      const orchestrator = loader.loadTemplate("agents/orchestrator.md");
      expect(orchestrator).toContain("Prefer multiple sub-agents to parallelize your work");
    });

    it("should load sandbox and approval permission templates", () => {
      const loader = new PromptTemplateLoader();
      const sandbox = loader.loadTemplate("permissions/sandbox_mode/workspace_write.md", {
        network_access: "enabled",
      });
      expect(sandbox).toContain("`sandbox_mode` is `workspace-write`");
      expect(sandbox).toContain("Network access is enabled.");

      const approval = loader.loadTemplate("permissions/approval_policy/on_request.md");
      expect(approval).toContain("# Escalation Requests");
    });

    it("should respect workspace overrides in .agents/templates/", () => {
      const workspaceTplDir = join(testDir, ".agents", "templates", "modes");
      mkdirSync(workspaceTplDir, { recursive: true });
      writeFileSync(
        join(workspaceTplDir, "default.md"),
        "# Custom Workspace Mode\nHello {{USER_NAME}}!"
      );

      const loader = new PromptTemplateLoader();
      const result = loader.loadTemplate(
        "modes/default.md",
        { USER_NAME: "Developer" },
        testDir
      );

      expect(result).toContain("# Custom Workspace Mode");
      expect(result).toContain("Hello Developer!");
    });
  });

  describe("AgentsMdLoader", () => {
    it("should hierarchically discover and concatenate AGENTS.md files", () => {
      // Simulate git repo root
      const repoRoot = join(testDir, "repo");
      const subDir = join(repoRoot, "src", "feature");
      mkdirSync(join(repoRoot, ".git"), { recursive: true });
      mkdirSync(subDir, { recursive: true });

      // Root AGENTS.md
      writeFileSync(
        join(repoRoot, "AGENTS.md"),
        "# Root Rules\n- Rule 1: Clean code"
      );

      // Sub-directory AGENTS.md
      writeFileSync(
        join(subDir, "AGENTS.md"),
        "# Feature Rules\n- Rule 2: Strict typing"
      );

      const loader = new AgentsMdLoader();
      const loaded = loader.loadProjectInstructions(subDir);

      expect(loaded).not.toBeNull();
      expect(loaded!.content).toContain("# Root Rules\n- Rule 1: Clean code");
      expect(loaded!.content).toContain("--- project-doc ---");
      expect(loaded!.content).toContain("# Feature Rules\n- Rule 2: Strict typing");
      expect(loaded!.sourcePaths.length).toBe(2);
    });

    it("should return null if no AGENTS.md file is found", () => {
      const loader = new AgentsMdLoader();
      const loaded = loader.loadProjectInstructions(testDir);
      expect(loaded).toBeNull();
    });
  });

  describe("buildSystemPrompt Integration", () => {
    it("should assemble system prompt using markdown templates, personality, orchestrator, and project instructions", () => {
      // Setup temporary project with AGENTS.md
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(
        join(testDir, "AGENTS.md"),
        "Always use typescript and write unit tests."
      );

      const prompt = buildSystemPrompt({
        collaborationMode: "plan",
        personality: "pragmatic",
        isOrchestrator: true,
        sandboxMode: "workspace_write",
        approvalPolicy: "on_request",
        networkAccess: true,
        cwd: testDir,
        memoriesPrompt: "User prefers concise answers.",
        skillsPrompt: "Available skills: search, patch",
        developerInstructions: "Follow strict coding rules.",
      });

      expect(prompt).toContain("You are Groupy");
      expect(prompt).toContain("deeply pragmatic, effective software engineer");
      expect(prompt).toContain("Prefer multiple sub-agents to parallelize your work");
      expect(prompt).toContain("# Plan Mode (Conversational)");
      expect(prompt).toContain("`sandbox_mode` is `workspace-write`");
      expect(prompt).toContain("# Escalation Requests");
      expect(prompt).toContain("## Project Instructions (AGENTS.md)");
      expect(prompt).toContain("Always use typescript and write unit tests.");
      expect(prompt).toContain("User prefers concise answers.");
      expect(prompt).toContain("Available skills: search, patch");
      expect(prompt).toContain("## Developer Instructions\nFollow strict coding rules.");
    });
  });
});
