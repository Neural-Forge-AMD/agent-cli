import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpManager } from "../src/mcp/manager";
import { Session } from "../src/session/session";
import { ToolRouter } from "../src/tools/router";
import { handleSlashCommand } from "../src/cli/commands";

describe("Interactive /mcp Slash Command & Manager Subsystem", () => {
  let testWorkspace: string;
  let mcpManager: McpManager;
  let session: Session;
  let tools: ToolRouter;

  beforeEach(() => {
    testWorkspace = join(tmpdir(), `pikaa_mcp_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(testWorkspace, { recursive: true });

    tools = new ToolRouter();
    mcpManager = new McpManager();
    session = new Session({
      cwd: testWorkspace,
      tools,
    });
  });

  afterEach(async () => {
    await mcpManager.closeAll();
    try {
      if (existsSync(testWorkspace)) {
        rmSync(testWorkspace, { recursive: true, force: true });
      }
    } catch {}
  });

  it("should handle /mcp help and print command options", async () => {
    let captured = "";
    const orig = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(" ") + "\n";
    };

    try {
      const handled = await handleSlashCommand("/mcp help", {
        session,
        mcpManager,
      });

      expect(handled).toBe(true);
      expect(captured).toContain("Model Context Protocol (MCP) Commands");
      expect(captured).toContain("/mcp list");
      expect(captured).toContain("/mcp add");
      expect(captured).toContain("/mcp tools");
      expect(captured).toContain("/mcp test");
    } finally {
      console.log = orig;
    }
  });

  it("should handle /mcp list when no servers are connected", async () => {
    let captured = "";
    const orig = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(" ") + "\n";
    };

    try {
      const handled = await handleSlashCommand("/mcp list", {
        session,
        mcpManager,
      });

      expect(handled).toBe(true);
      expect(captured).toContain("Model Context Protocol (MCP) Servers");
      expect(captured).toContain("No active MCP servers connected");
    } finally {
      console.log = orig;
    }
  });

  it("should save and remove MCP server configurations in target JSON file", () => {
    const configPath = join(testWorkspace, ".mcp.json");

    // 1. Save server
    mcpManager.saveServerToConfigFile(configPath, "sqlite-db", {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite", "test.db"],
      env: { DEBUG: "1" },
    });

    expect(existsSync(configPath)).toBe(true);
    const content = JSON.parse(readFileSync(configPath, "utf8"));
    expect(content.mcpServers["sqlite-db"]).toBeDefined();
    expect(content.mcpServers["sqlite-db"].command).toBe("npx");

    // 2. Remove server
    const removed = mcpManager.removeServerFromConfigFile(configPath, "sqlite-db");
    expect(removed).toBe(true);

    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    expect(updated.mcpServers["sqlite-db"]).toBeUndefined();
  });

  it("should unregister MCP tools from ToolRouter when server is removed", async () => {
    // Manually register mock tools with prefix mcp__github__
    tools.register({
      name: "mcp__github__create_issue",
      description: "Create an issue on GitHub",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ output: "ok" }),
    });
    tools.register({
      name: "mcp__github__list_repos",
      description: "List repos",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ output: "ok" }),
    });
    tools.register({
      name: "read_file",
      description: "Native tool",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ output: "native" }),
    });

    expect(tools.has("mcp__github__create_issue")).toBe(true);
    expect(tools.has("mcp__github__list_repos")).toBe(true);
    expect(tools.has("read_file")).toBe(true);

    // Unregister prefix
    const removedCount = tools.unregisterPrefix("mcp__github__");
    expect(removedCount).toBe(2);

    expect(tools.has("mcp__github__create_issue")).toBe(false);
    expect(tools.has("mcp__github__list_repos")).toBe(false);
    expect(tools.has("read_file")).toBe(true);
  });
});
