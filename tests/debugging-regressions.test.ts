import { describe, it, expect } from "bun:test";
import { parseShellCommand } from "../src/security/shell-parser";
import { PrefixRulesStore } from "../src/storage/prefix-rules-store";
import { AgentSpawner } from "../src/agents/spawner";
import { Session } from "../src/session/session";
import { ToolRouter } from "../src/tools/router";

describe("Debugging & Regression Guards", () => {
  describe("Shell Parser Subshell Quote Invariance", () => {
    it("should correctly preserve parentheses inside quotes within subshells $(...)", () => {
      const cmd = 'echo $(echo ")")';
      const parsed = parseShellCommand(cmd);

      expect(parsed.subshellCommands.length).toBe(1);
      expect(parsed.subshellCommands[0]).toBe('echo ")"');
      expect(parsed.commands[0]).toBe('echo $(echo ")")');
    });

    it("should handle nested commands with single and double quotes inside $(...)", () => {
      const cmd = 'result=$(python3 -c \'print("(") \') && echo $result';
      const parsed = parseShellCommand(cmd);

      expect(parsed.subshellCommands.length).toBe(1);
      expect(parsed.subshellCommands[0]).toBe('python3 -c \'print("(") \'');
      expect(parsed.commands.length).toBe(2);
      expect(parsed.commands[1]).toBe("echo $result");
    });
  });

  describe("Prefix Rules Store Operator Chaining Guards", () => {
    it("should reject prefix matching when command tokens contain unspaced pipe or ampersand", () => {
      const store = new PrefixRulesStore(":memory:");
      const ws = process.cwd();
      store.addRule(ws, ["cat"]);

      expect(store.isApproved(ws, ["cat", "file.txt"])).toBe(true);
      expect(store.isApproved(ws, ["cat", "foo|bar"])).toBe(false);
      expect(store.isApproved(ws, ["cat", "foo&bar"])).toBe(false);
      expect(store.isApproved(ws, ["cat", "foo;bar"])).toBe(false);

      store.close();
    });
  });

  describe("Sub-Agent Interruption & Close Lifecycle", () => {
    it("should resolve promise and preserve lastOutput when closeAgent is invoked", async () => {
      const parentSession = new Session({
        threadId: "parent_test_thread",
        tools: new ToolRouter(),
      });

      const spawner = new AgentSpawner(parentSession);
      const summary = await spawner.spawnAgent({
        taskName: "long_task",
        message: "sleep and do work",
      });

      const handle = spawner.getAgent(summary.id);
      expect(handle).toBeDefined();
      expect(handle?.status).toBe("running");

      const closeMsg = await spawner.closeAgent(summary.id);
      expect(closeMsg).toContain("interrupted and closed");

      expect(handle?.status).toBe("interrupted");
      expect(handle?.lastOutput).toBeDefined();

      const output = await spawner.waitAgent(summary.id, 5000);
      expect(output).toBe("[Task was interrupted]");
    });
  });
});
