import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BrowserLauncher } from "../src/mcp/servers/chrome-devtools/launcher";
import { getChromeDevToolsToolSchemas } from "../src/mcp/servers/chrome-devtools/tools";
import { ChromeDevToolsMcpServer } from "../src/mcp/servers/chrome-devtools/server";
import { CHROME_DEVTOOLS_MCP_SERVER_PATH } from "../src/mcp/servers/chrome-devtools";
import { McpManager } from "../src/mcp/manager";
import { ToolRouter } from "../src/tools/router";

describe("Local Chrome DevTools MCP Subsystem (Antigravity & Codex Aligned)", () => {
  it("should discover browser executable path on current platform (Windows/macOS/Linux)", () => {
    const executable = BrowserLauncher.findBrowserExecutable();
    // On Windows development machines, Chrome or Edge is guaranteed to exist
    if (process.platform === "win32") {
      expect(executable).not.toBeNull();
      expect(typeof executable).toBe("string");
    }
  });

  it("should export full suite of tool schemas matching Google Antigravity specifications", () => {
    const tools = getChromeDevToolsToolSchemas();
    expect(tools.length).toBeGreaterThanOrEqual(18);

    const toolNames = tools.map((t) => t.name);

    // Verify key Antigravity tools exist
    expect(toolNames).toContain("new_page");
    expect(toolNames).toContain("list_pages");
    expect(toolNames).toContain("select_page");
    expect(toolNames).toContain("close_page");
    expect(toolNames).toContain("navigate_page");
    expect(toolNames).toContain("take_snapshot");
    expect(toolNames).toContain("take_screenshot");
    expect(toolNames).toContain("click");
    expect(toolNames).toContain("hover");
    expect(toolNames).toContain("type_text");
    expect(toolNames).toContain("fill");
    expect(toolNames).toContain("fill_form");
    expect(toolNames).toContain("press_key");
    expect(toolNames).toContain("wait_for");
    expect(toolNames).toContain("evaluate_script");
    expect(toolNames).toContain("resize_page");
    expect(toolNames).toContain("list_console_messages");
    expect(toolNames).toContain("list_network_requests");
  });

  it("should respond to MCP JSON-RPC 2.0 handshake and list tools in ChromeDevToolsMcpServer", async () => {
    const server = new ChromeDevToolsMcpServer();

    // 1. Test initialize
    const initRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" } as any,
    });

    expect(initRes).not.toBeNull();
    expect((initRes?.result as any)?.serverInfo?.name).toBe("chrome-devtools-mcp");

    // 2. Test tools/list
    const listRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect((listRes?.result as any)?.tools?.length).toBeGreaterThanOrEqual(18);
    const snapshotTool = (listRes?.result as any)?.tools?.find((t: any) => t.name === "take_snapshot");
    expect(snapshotTool).toBeDefined();
    expect(snapshotTool.inputSchema.required).toContain("pageId");

    // 3. Test ping
    const pingRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
    });
    expect(pingRes?.error).toBeUndefined();
  });

  it("should connect ChromeDevTools MCP server via McpManager stdio transport seamlessly", async () => {
    const manager = new McpManager();
    const router = new ToolRouter();

    try {
      // Connect to the real ChromeDevTools server entry point via Bun subprocess
      await manager.registerServer("chrome", {
        type: "stdio",
        command: process.execPath,
        args: [CHROME_DEVTOOLS_MCP_SERVER_PATH],
      });

      const client = manager.getClient("chrome");
      expect(client).toBeDefined();
      expect(client?.isConnected()).toBe(true);

      const tools = client?.getTools() || [];
      expect(tools.length).toBeGreaterThanOrEqual(18);

      // Register into ToolRouter
      manager.registerToolsIntoRouter(router);

      // Since Chrome has > 8 tools (18+), it should be lazy loaded!
      expect(manager.isServerLazy("chrome")).toBe(true);
      expect(router.has("call_mcp_tool")).toBe(true);
      expect(router.has("get_mcp_tool_schema")).toBe(true);

      // Verify formatMcpPrompt lists chrome tools under Lazy section
      const prompt = manager.formatMcpPrompt();
      expect(prompt).toContain("<mcp_servers>");
      expect(prompt).toContain("# chrome");
      expect(prompt).toContain("Lazy:");
      expect(prompt).toContain("take_snapshot");
      expect(prompt).toContain("take_screenshot");
      expect(prompt).toContain("click");
      expect(prompt).toContain("fill_form");

      // Verify get_mcp_tool_schema can inspect tool schema
      const schemaTool = router.get("get_mcp_tool_schema")!;
      const schemaRes = await schemaTool.execute(
        { ServerName: "chrome", ToolName: "navigate_page" },
        {} as any
      );
      expect(schemaRes.output).toContain("navigate_page");
      expect(schemaRes.output).toContain("pageId");
    } finally {
      await manager.closeAll();
    }
  });
});
