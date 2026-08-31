import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PrefixRulesStore } from "../src/storage/prefix-rules-store";
import { createShellTool } from "../src/tools/handlers/shell";
import { ExecPolicy } from "../src/security/exec-policy";
import type { ToolContext } from "../src/tools/types";

describe("Shell Escalation & Prefix Rules Engine", () => {
  let store: PrefixRulesStore;
  const testWs = process.cwd();

  beforeEach(() => {
    store = new PrefixRulesStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("PrefixRulesStore (SQLite)", () => {
    it("should store and verify approved prefix rules", () => {
      store.addRule(testWs, ["npm", "install"]);

      expect(store.isApproved(testWs, ["npm", "install"])).toBe(true);
      expect(store.isApproved(testWs, ["npm", "install", "zod", "--save"])).toBe(true);
      expect(store.isApproved(testWs, ["npm", "run", "dev"])).toBe(false);
      expect(store.isApproved("/other/ws", ["npm", "install"])).toBe(false);
    });

    it("should support global wildcard rules", () => {
      store.addRule("*", ["git", "status"]);

      expect(store.isApproved("/any/random/path", ["git", "status"])).toBe(true);
      expect(store.isApproved("/any/random/path", ["git", "push"])).toBe(false);
    });

    it("should list and remove rules cleanly", () => {
      store.addRule(testWs, ["cargo", "test"]);
      store.addRule(testWs, ["cargo", "build"]);

      const rules = store.listRules(testWs);
      expect(rules.length).toBe(2);

      store.removeRule(testWs, ["cargo", "test"]);
      expect(store.isApproved(testWs, ["cargo", "test"])).toBe(false);
      expect(store.isApproved(testWs, ["cargo", "build"])).toBe(true);
    });
  });

  describe("Shell Tool Escalation Integration", () => {
    it("should bypass approval prompt if command matches approved prefix rule", async () => {
      store.addRule(testWs, ["echo"]);

      let approvalPrompted = false;
      const ctx: ToolContext = {
        cwd: testWs,
        turnId: "turn_shell_1",
        prefixRulesStore: store,
        requestApproval: async () => {
          approvalPrompted = true;
          return true;
        },
      };

      const shell = createShellTool();
      const result = await shell.execute(
        {
          command: "echo 'hello escalated world'",
          sandbox_permissions: "require_escalated",
        },
        ctx
      );

      expect(approvalPrompted).toBe(false); // Bypassed prompt because 'echo' is approved
      expect(result.output).toContain("hello escalated world");
    }, 30000);

    it("should prompt user when sandbox_permissions is require_escalated and save prefix rule if requested", async () => {
      let promptCalled = false;
      const ctx: ToolContext = {
        cwd: testWs,
        turnId: "turn_shell_2",
        prefixRulesStore: store,
        requestApproval: async (desc, cmd, prefixRule) => {
          promptCalled = true;
          expect(desc).toBe("Need to install dependencies");
          expect(prefixRule).toEqual(["echo", "prefix-saved"]);
          return { allowed: true, rememberPrefix: true };
        },
      };

      const shell = createShellTool();
      const result = await shell.execute(
        {
          command: "echo prefix-saved 'first time run'",
          sandbox_permissions: "require_escalated",
          prefix_rule: ["echo", "prefix-saved"],
          justification: "Need to install dependencies",
        },
        ctx
      );

      expect(promptCalled).toBe(true);
      expect(result.output).toContain("first time run");

      // Verify that the prefix rule is now saved in SQLite
      expect(store.isApproved(testWs, ["echo", "prefix-saved", "second", "run"])).toBe(true);
    }, 30000);

    it("should cancel execution if user rejects escalation prompt", async () => {
      const ctx: ToolContext = {
        cwd: testWs,
        turnId: "turn_shell_3",
        prefixRulesStore: store,
        requestApproval: async () => {
          return false; // User denies
        },
      };

      const shell = createShellTool();
      const result = await shell.execute(
        {
          command: "npm install dangerous-package",
          sandbox_permissions: "require_escalated",
          justification: "Attempting package install",
        },
        ctx
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("User declined approval");
    }, 30000);
  });
});
