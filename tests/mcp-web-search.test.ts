import { describe, it, expect } from "bun:test";
import { HtmlToMarkdownConverter } from "../src/mcp/servers/web-search/html-to-markdown";
import { getWebSearchToolSchemas } from "../src/mcp/servers/web-search/tools";
import { WebSearchMcpServer } from "../src/mcp/servers/web-search/server";
import { WEB_SEARCH_MCP_SERVER_PATH } from "../src/mcp/servers/web-search";
import { McpManager } from "../src/mcp/manager";
import { ToolRouter } from "../src/tools/router";

describe("Cloud Web Search & Live Docs MCP Subsystem", () => {
  it("should convert dirty HTML to clean structured Markdown with code blocks and headers", () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title><style>body { color: red; }</style></head>
        <body>
          <nav><a href="/home">Home</a></nav>
          <header><h1>Site Header Banner</h1></header>
          <main>
            <h1>Welcome to Bun & Groupy</h1>
            <p>Groupy is an <strong>agentic AI coding assistant</strong> &amp; CLI.</p>
            <h2>Quick Installation</h2>
            <pre><code class="language-bash">bun add -g @groupy/cli</code></pre>
            <ul>
              <li>Fast execution</li>
              <li>Multi-agent orchestration</li>
            </ul>
            <blockquote>Powerful pair programming</blockquote>
            <a href="https://bun.sh">Learn more about Bun</a>
          </main>
          <footer><p>&copy; 2026 Mesosfer</p></footer>
          <script>console.log("analytics");</script>
        </body>
      </html>
    `;

    const md = HtmlToMarkdownConverter.convert(rawHtml);

    // Nav, footer, scripts, styles should be stripped
    expect(md).not.toContain("Site Header Banner");
    expect(md).not.toContain("&copy; 2026");
    expect(md).not.toContain("color: red;");
    expect(md).not.toContain("analytics");

    // Main article content and markdown syntax should be preserved
    expect(md).toContain("# Welcome to Bun & Groupy");
    expect(md).toContain("**agentic AI coding assistant** & CLI.");
    expect(md).toContain("## Quick Installation");
    expect(md).toContain("```bash\nbun add -g @groupy/cli\n```");
    expect(md).toContain("- Fast execution");
    expect(md).toContain("- Multi-agent orchestration");
    expect(md).toContain("> Powerful pair programming");
    expect(md).toContain("[Learn more about Bun](https://bun.sh)");
  });

  it("should export full suite of Web Search & Live Docs tool schemas", () => {
    const tools = getWebSearchToolSchemas();
    expect(tools.length).toBeGreaterThanOrEqual(4);

    const names = tools.map((t) => t.name);
    expect(names).toContain("search_web");
    expect(names).toContain("read_url_content");
    expect(names).toContain("search_package_docs");
    expect(names).toContain("search_github_issues");
  });

  it("should respond to MCP JSON-RPC 2.0 protocol in WebSearchMcpServer", async () => {
    const server = new WebSearchMcpServer();

    // 1. initialize
    const initRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" } as any,
    });
    expect(initRes).not.toBeNull();
    expect((initRes?.result as any)?.serverInfo?.name).toBe("web-search-mcp");

    // 2. tools/list
    const listRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect((listRes?.result as any)?.tools?.length).toBeGreaterThanOrEqual(4);

    // 3. tools/call test (search_package_docs with npm 'zod')
    const callRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_package_docs",
        arguments: { packageName: "zod", ecosystem: "npm" },
      },
    });

    expect(callRes?.result).toBeDefined();
    const content = (callRes?.result as any)?.content?.[0]?.text;
    expect(content).toContain("zod");
    expect(content).toContain("version");
  });

  it("should connect WebSearch MCP server via McpManager stdio transport seamlessly", async () => {
    const manager = new McpManager();
    const router = new ToolRouter();

    try {
      await manager.registerServer("search", {
        type: "stdio",
        command: process.execPath,
        args: [WEB_SEARCH_MCP_SERVER_PATH],
      });

      const client = manager.getClient("search");
      expect(client).toBeDefined();
      expect(client?.isConnected()).toBe(true);

      const tools = client?.getTools() || [];
      expect(tools.length).toBeGreaterThanOrEqual(4);

      manager.registerToolsIntoRouter(router);

      // WebSearch has <= 8 tools, so eager-loaded directly into router!
      expect(manager.isServerLazy("search")).toBe(false);
      expect(router.has("mcp__search__search_web")).toBe(true);
      expect(router.has("mcp__search__read_url_content")).toBe(true);
      expect(router.has("mcp__search__search_package_docs")).toBe(true);
      expect(router.has("mcp__search__search_github_issues")).toBe(true);

      // Verify prompt includes search tools in Eager section
      const prompt = manager.formatMcpPrompt();
      expect(prompt).toContain("<mcp_servers>");
      expect(prompt).toContain("# search");
      expect(prompt).toContain("Eager:");
      expect(prompt).toContain("mcp__search__search_web");
    } finally {
      await manager.closeAll();
    }
  });
});
