/**
 * McpManager - Manages multiple MCP server connections and bridges
 * MCP tools and resources directly into Groupy's ToolRouter.
 * 
 * Directly mirrors codex-rs/core/src/mcp.rs & codex-mcp.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpClient } from "./client";
import { StdioTransport, SseTransport } from "./transport";
import type { McpServerConfig, McpServersConfigFile } from "./types";
import type { ToolRouter } from "../tools/router";
import type { Tool } from "../tools/types";

export class McpManager {
  private clients = new Map<string, McpClient>();

  /**
   * Register and initialize an MCP server from configuration
   */
  async registerServer(name: string, config: McpServerConfig): Promise<McpClient> {
    const transport =
      config.type === "stdio"
        ? new StdioTransport(config.command, config.args, config.env, config.cwd)
        : new SseTransport(config.url, config.headers);

    const client = new McpClient(name, transport);
    await client.connect();
    this.clients.set(name, client);
    return client;
  }

  /**
   * Loads servers from an MCP config object (e.g. mcp_config.json)
   */
  async loadConfig(config: McpServersConfigFile): Promise<void> {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        await this.registerServer(name, serverConfig);
      } catch (err) {
        console.error(`Failed to initialize MCP server '${name}':`, err);
      }
    }
  }

  /**
   * Loads servers from a JSON config file path (e.g. .mcp.json, mcp_config.json)
   */
  async loadConfigFile(filePath: string): Promise<void> {
    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) return;

    try {
      const content = readFileSync(fullPath, "utf8");
      const parsed: McpServersConfigFile = JSON.parse(content);
      if (parsed.mcpServers) {
        await this.loadConfig(parsed);
      }
    } catch (err) {
      console.error(`Failed to load MCP config file '${filePath}':`, err);
    }
  }

  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  listClients(): McpClient[] {
    return Array.from(this.clients.values());
  }

  listServers(): Array<{ name: string; connected: boolean; toolsCount: number; resourcesCount: number }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      connected: client.isConnected(),
      toolsCount: client.getTools().length,
      resourcesCount: client.getResources().length,
    }));
  }

  /**
   * Converts all discovered MCP tools from all connected servers
   * and registers them into Groupy's ToolRouter.
   */
  registerToolsIntoRouter(router: ToolRouter): void {
    let hasResources = false;

    for (const [serverName, client] of this.clients) {
      // 1. Register Function Tools
      for (const mcpTool of client.getTools()) {
        const namespacedName = `mcp__${serverName}__${mcpTool.name}`;

        const tool: Tool = {
          name: namespacedName,
          description: `[MCP: ${serverName}] ${mcpTool.description || "MCP Server Tool"}`,
          parameters: {
            type: "object",
            properties: (mcpTool.inputSchema.properties || {}) as any,
            required: mcpTool.inputSchema.required,
          },
          async execute(args) {
            return client.callTool(mcpTool.name, args);
          },
        };

        router.register(tool);
      }

      if (client.getResources().length > 0) {
        hasResources = true;
      }
    }

    // 2. Register Read Resource Tool if any server advertises resources
    if (hasResources) {
      const readResourceTool: Tool = {
        name: "read_mcp_resource",
        description: "Read the contents of an MCP resource by URI across connected MCP servers.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "Name of the MCP server hosting the resource" },
            uri: { type: "string", description: "Resource URI (e.g. file:///path, custom://resource)" },
          },
          required: ["server", "uri"],
        },
        execute: async (args) => {
          const serverName = String(args.server || "");
          const uri = String(args.uri || "");
          const client = this.getClient(serverName);

          if (!client) {
            return { output: `Error: MCP server '${serverName}' not found`, isError: true };
          }

          try {
            const res = await client.readResource(uri);
            return { output: res.contents };
          } catch (err) {
            return {
              output: `Error reading resource: ${err instanceof Error ? err.message : String(err)}`,
              isError: true,
            };
          }
        },
      };

      router.register(readResourceTool);
    }
  }

  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
