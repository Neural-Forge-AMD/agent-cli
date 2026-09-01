import { describe, it, expect } from "bun:test";
import { ExecPolicy, type PermissionMode } from "../src/security/exec-policy";
import { Session } from "../src/session/session";
import { ToolRouter } from "../src/tools/router";
import { createDefaultTools } from "../src/tools";
import { InteractiveLineEditor } from "../src/cli/ui/line-editor";

describe("Claude Code 4-Mode Permission & Security Engine", () => {
  describe("ExecPolicy Mode Transitions", () => {
    it("should initialize in auto mode by default", () => {
      const policy = new ExecPolicy();
      expect(policy.getMode()).toBe("auto");
    });

    it("should allow switching between all 4 permission modes", () => {
      const policy = new ExecPolicy();
      const modes: PermissionMode[] = ["auto", "manual", "accept-edits", "plan"];

      for (const m of modes) {
        policy.setMode(m);
        expect(policy.getMode()).toBe(m);
      }
    });

    it("should evaluate file edits according to active mode", () => {
      const policy = new ExecPolicy();

      // Auto mode -> auto approve file writes
      policy.setMode("auto");
      expect(policy.shouldPromptFileEdit("src/app.ts").prompt).toBe(false);
      expect(policy.shouldPromptFileEdit("src/app.ts").isPlanBlocked).toBeFalsy();

      // Accept-edits mode -> auto approve file writes
      policy.setMode("accept-edits");
      expect(policy.shouldPromptFileEdit("src/app.ts").prompt).toBe(false);

      // Manual mode -> prompt for confirmation
      policy.setMode("manual");
      expect(policy.shouldPromptFileEdit("src/app.ts").prompt).toBe(true);
      expect(policy.shouldPromptFileEdit("src/app.ts").reason).toContain("Manual mode");

      // Plan mode -> block file mutations
      policy.setMode("plan");
      expect(policy.shouldPromptFileEdit("src/app.ts").isPlanBlocked).toBe(true);
      expect(policy.shouldPromptFileEdit("src/app.ts").reason).toContain("Plan Mode is active");
    });

    it("should evaluate shell commands according to active mode", () => {
      const policy = new ExecPolicy();

      // Auto mode -> allow standard safe commands
      policy.setMode("auto");
      expect(policy.evaluate("git status").decision).toBe("allow");
      expect(policy.evaluate("rm -rf /").decision).toBe("prompt");

      // Manual mode -> prompt for ALL commands
      policy.setMode("manual");
      expect(policy.evaluate("git status").decision).toBe("prompt");
      expect(policy.evaluate("ls").decision).toBe("prompt");

      // Accept-edits mode -> allow read-only, prompt for active shell commands
      policy.setMode("accept-edits");
      expect(policy.evaluate("git status").decision).toBe("allow");
      expect(policy.evaluate("npm run deploy").decision).toBe("prompt");

      // Plan mode -> allow only read-only queries, deny mutating commands
      policy.setMode("plan");
      expect(policy.evaluate("git status").decision).toBe("allow");
      expect(policy.evaluate("npm install").decision).toBe("deny");
    });
  });

  describe("Session & Tools Mode Integration", () => {
    it("should synchronize permissionMode with ExecPolicy and collaborationMode", () => {
      const session = new Session();
      expect(session.permissionMode).toBe("auto");
      expect(session.collaborationMode).toBe("default");

      session.setPermissionMode("manual");
      expect(session.permissionMode).toBe("manual");
      expect(session.collaborationMode).toBe("default");

      session.setPermissionMode("plan");
      expect(session.permissionMode).toBe("plan");
      expect(session.collaborationMode).toBe("plan");

      session.setPermissionMode("auto");
      expect(session.permissionMode).toBe("auto");
      expect(session.collaborationMode).toBe("default");
    });

    it("should block writeFileTool in plan mode", async () => {
      const tools = createDefaultTools();
      const policy = new ExecPolicy("plan");

      const result = await tools.execute("write_file", { path: "test.txt", content: "hello" }, {
        cwd: process.cwd(),
        turnId: "t1",
        execPolicy: policy,
        mode: "plan",
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Cannot write or mutate files while in Plan Mode");
    });

    it("should block applyPatchTool in plan mode", async () => {
      const tools = createDefaultTools();
      const policy = new ExecPolicy("plan");

      const result = await tools.execute("apply_patch", { path: "test.txt", replacementContent: "hello" }, {
        cwd: process.cwd(),
        turnId: "t1",
        execPolicy: policy,
        mode: "plan",
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Cannot mutate files while in Plan Mode");
    });
  });

  describe("InteractiveLineEditor Mode Cycling", () => {
    it("should cycle forward through all 4 modes on Shift+Tab", () => {
      let notifiedMode = "";
      const editor = new InteractiveLineEditor({
        initialMode: "auto",
        onModeChange: (m) => { notifiedMode = m; },
      });

      expect(editor.getMode()).toBe("auto");

      expect(editor.cycleMode()).toBe("manual");
      expect(notifiedMode).toBe("manual");

      expect(editor.cycleMode()).toBe("accept-edits");
      expect(notifiedMode).toBe("accept-edits");

      expect(editor.cycleMode()).toBe("plan");
      expect(notifiedMode).toBe("plan");

      expect(editor.cycleMode()).toBe("auto");
      expect(notifiedMode).toBe("auto");
    });

    it("should support programmatic setMode", () => {
      const editor = new InteractiveLineEditor({ initialMode: "auto" });
      editor.setMode("plan");
      expect(editor.getMode()).toBe("plan");
    });
  });
});
