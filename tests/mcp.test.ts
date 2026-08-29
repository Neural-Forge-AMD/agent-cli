import { describe, expect, test, afterAll } from "bun:test";
import { resolve } from "node:path";
import { McpManager } from "../src/mcp/manager";
import { ToolRouter } from "../src/tools/router";

const mockServerPath = resolve(import.meta.dir, "fixtures/mock-mcp-server.ts");

describe("MCP Client & Manager Integration", () => {
  const manager = new McpManager();

  afterAll(async () => {
    await manager.closeAll();
  });

  test("connects to Stdio MCP server, initializes, and discovers tools and resources", async () => {
    const client = await manager.registerServer("db_service", {
      type: "stdio",
      command: "bun",
      args: ["run", mockServerPath],
    });

    expect(client).toBeDefined();

    // Verify tools
    const tools = client.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("query_database");

    // Verify resources
    const resources = client.getResources();
    expect(resources.length).toBe(1);
    expect(resources[0]?.uri).toBe("schema://main");
  });

  test("bridges discovered MCP tools and resources into Groupy ToolRouter", async () => {
    const router = new ToolRouter();
    manager.registerToolsIntoRouter(router);

    // 1. Check Function Tool
    const mcpToolName = "mcp__db_service__query_database";
    expect(router.has(mcpToolName)).toBe(true);

    const toolResult = await router.execute(
      mcpToolName,
      { query: "SELECT * FROM users" },
      { cwd: process.cwd(), turnId: "test_turn" }
    );

    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.output).toContain("SELECT * FROM users");
    expect(toolResult.output).toContain("42 rows found");

    // 2. Check Resource Tool
    expect(router.has("read_mcp_resource")).toBe(true);
    const resourceResult = await router.execute(
      "read_mcp_resource",
      { server: "db_service", uri: "schema://main" },
      { cwd: process.cwd(), turnId: "test_turn" }
    );

    expect(resourceResult.isError).toBeFalsy();
    expect(resourceResult.output).toContain("CREATE TABLE users");
  });
});
