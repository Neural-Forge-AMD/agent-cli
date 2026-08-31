/**
 * McpManager - Manages multiple MCP server connections and bridges
 * MCP tools and resources directly into Groupy's ToolRouter with
 * Lazy-Loading Meta Dispatcher (call_mcp_tool) to conserve LLM context tokens.
 * 
 * Directly mirrors Antigravity & OpenAI Codex MCP architecture.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { McpClient } from "./client";
import { StdioTransport, SseTransport } from "./transport";
import type { McpServerConfig, McpServersConfigFile, McpToolSchema } from "./types";
import type { ToolRouter } from "../tools/router";
import type { Tool } from "../tools/types";

export class McpManager {
  private clients = new Map<string, McpClient>();
  private serverConfigs = new Map<string, McpServerConfig>();
  private loadedConfigFiles = new Set<string>();
  public lazyThreshold = 8; // Automatically lazy-load servers with more than 8 tools

  /**
   * Register and initialize an MCP server from configuration
   */
  async registerServer(name: string, config: McpServerConfig): Promise<McpClient> {
    // If client with same name exists, close it first
    if (this.clients.has(name)) {
      try {
        await this.clients.get(name)!.close();
      } catch {}
      this.clients.delete(name);
      this.serverConfigs.delete(name);
    }

    const transport =
      config.type === "stdio"
        ? new StdioTransport(config.command, config.args, config.env, config.cwd)
        : new SseTransport(config.url, config.headers);

    const client = new McpClient(name, transport);
    await client.connect();
    this.clients.set(name, client);
    this.serverConfigs.set(name, config);
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

    this.loadedConfigFiles.add(fullPath);

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

  getServerConfig(name: string): McpServerConfig | undefined {
    return this.serverConfigs.get(name);
  }

  listClients(): McpClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Determines if a server should be lazy-loaded
   */
  isServerLazy(name: string): boolean {
    const client = this.clients.get(name);
    if (!client) return false;
    const config = this.serverConfigs.get(name);
    if (config?.lazy === true) return true;
    if (config?.lazy === false) return false;
    return client.getTools().length > this.lazyThreshold;
  }

  listServers(): Array<{
    name: string;
    connected: boolean;
    serverInfo: any;
    toolsCount: number;
    resourcesCount: number;
    promptsCount: number;
    isLazy: boolean;
  }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      connected: client.isConnected(),
      serverInfo: client.getServerInfo(),
      toolsCount: client.getTools().length,
      resourcesCount: client.getResources().length,
      promptsCount: client.getPrompts().length,
      isLazy: this.isServerLazy(name),
    }));
  }

  /**
   * Pings an individual MCP server and measures latency
   */
  async pingServer(name: string): Promise<{ success: boolean; durationMs: number; error?: string }> {
    const client = this.getClient(name);
    if (!client) {
      return { success: false, durationMs: 0, error: `MCP server '${name}' not found` };
    }
    return client.ping();
  }

  /**
   * Disconnects and removes an active MCP server
   */
  async removeServer(name: string, router?: ToolRouter): Promise<boolean> {
    const client = this.clients.get(name);
    if (!client) return false;

    try {
      await client.close();
    } catch {}

    this.clients.delete(name);
    this.serverConfigs.delete(name);

    if (router) {
      router.unregisterPrefix(`mcp__${name}__`);
    }

    return true;
  }

  /**
   * Converts discovered MCP tools from all connected servers
   * into ToolRouter using Eager vs Lazy Loading strategy.
   */
  registerToolsIntoRouter(router: ToolRouter): void {
    if (this.clients.size === 0) return;

    let hasAnyLazyServer = false;
    let hasResources = false;

    for (const [serverName, client] of this.clients) {
      const isLazy = this.isServerLazy(serverName);

      if (isLazy) {
        hasAnyLazyServer = true;
      } else {
        // 1. Eager Registration for small servers
        for (const mcpTool of client.getTools()) {
          const namespacedName = `mcp__${serverName}__${mcpTool.name}`;

          const tool: Tool = {
            name: namespacedName,
            description: `[MCP: ${serverName}] ${mcpTool.description || "MCP Server Tool"}`,
            parameters: {
              type: "object",
              properties: (mcpTool.inputSchema?.properties || {}) as any,
              required: mcpTool.inputSchema?.required,
            },
            async execute(args) {
              return client.callTool(mcpTool.name, args);
            },
          };

          router.register(tool);
        }
      }

      if (client.getResources().length > 0) {
        hasResources = true;
      }
    }

    // 2. Register Lazy-Loading Meta Dispatcher (call_mcp_tool & get_mcp_tool_schema)
    // Registered whenever there is at least 1 connected MCP server to allow flexible dynamic calling
    const callMcpTool: Tool = {
      name: "call_mcp_tool",
      description:
        "Call a lazy-loaded tool from a connected Model Context Protocol (MCP) server. Use when invoking tools listed under 'Lazy' in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          ServerName: {
            type: "string",
            description: "Name of the MCP server hosting the tool (e.g. 'github', 'postgres', 'weather').",
          },
          ToolName: {
            type: "string",
            description: "Exact name of the tool to invoke on the MCP server.",
          },
          Arguments: {
            type: "object",
            description: "Key-value arguments object matching the tool's input schema.",
          },
        },
        required: ["ServerName", "ToolName", "Arguments"],
      },
      execute: async (args) => {
        const serverName = String(args.ServerName || args.server_name || args.server || "");
        const toolName = String(args.ToolName || args.tool_name || args.tool || "");
        const toolArgs = (args.Arguments || args.arguments || args.args || {}) as Record<string, unknown>;

        const client = this.getClient(serverName);
        if (!client) {
          const available = Array.from(this.clients.keys()).join(", ");
          return {
            output: `Error: MCP server '${serverName}' not found. Connected servers: [${available || "none"}]`,
            isError: true,
          };
        }

        try {
          return await client.callTool(toolName, toolArgs);
        } catch (err) {
          return {
            output: `Error executing MCP tool '${serverName}:${toolName}': ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      },
    };
    router.register(callMcpTool);

    const getToolSchemaTool: Tool = {
      name: "get_mcp_tool_schema",
      description: "Retrieve parameter specification and JSONSchema for a lazy-loaded MCP tool.",
      parameters: {
        type: "object",
        properties: {
          ServerName: { type: "string", description: "Name of the MCP server" },
          ToolName: { type: "string", description: "Name of the tool" },
        },
        required: ["ServerName", "ToolName"],
      },
      execute: async (args) => {
        const serverName = String(args.ServerName || args.server_name || args.server || "");
        const toolName = String(args.ToolName || args.tool_name || args.tool || "");

        const client = this.getClient(serverName);
        if (!client) {
          return { output: `Error: MCP server '${serverName}' not found`, isError: true };
        }

        const tool = client.getTools().find((t) => t.name === toolName);
        if (!tool) {
          return {
            output: `Error: Tool '${toolName}' not found on server '${serverName}'. Available: ${client.getTools().map((t) => t.name).join(", ")}`,
            isError: true,
          };
        }

        return { output: JSON.stringify(tool, null, 2) };
      },
    };
    router.register(getToolSchemaTool);

    // 3. Register Resource Tools
    const listResourcesTool: Tool = {
      name: "list_mcp_resources",
      description: "List available data resources exposed by a connected MCP server.",
      parameters: {
        type: "object",
        properties: {
          ServerName: { type: "string", description: "Name of the MCP server" },
        },
        required: ["ServerName"],
      },
      execute: async (args) => {
        const serverName = String(args.ServerName || args.server_name || args.server || "");
        const client = this.getClient(serverName);
        if (!client) {
          return { output: `Error: MCP server '${serverName}' not found`, isError: true };
        }
        return { output: JSON.stringify(client.getResources(), null, 2) };
      },
    };
    router.register(listResourcesTool);

    const readResourceTool: Tool = {
      name: "read_mcp_resource",
      description: "Read the contents of an MCP resource by URI across connected MCP servers.",
      parameters: {
        type: "object",
        properties: {
          ServerName: { type: "string", description: "Name of the MCP server hosting the resource" },
          Uri: { type: "string", description: "Resource URI (e.g. file:///path, custom://resource)" },
        },
        required: ["ServerName", "Uri"],
      },
      execute: async (args) => {
        const serverName = String(args.ServerName || args.server_name || args.server || args.server || "");
        const uri = String(args.Uri || args.uri || "");
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

  /**
   * Generates the system prompt section informing LLM of connected MCP servers,
   * categorizing tools into Eager vs Lazy loading (Codex / Antigravity format).
   */
  formatMcpPrompt(): string {
    if (this.clients.size === 0) return "";

    const lines: string[] = [];
    lines.push("\n## Model Context Protocol (MCP) Servers");
    lines.push("<mcp_servers>");
    lines.push("The following MCP servers and their available tools are configured:\n");

    for (const [serverName, client] of this.clients) {
      const tools = client.getTools();
      const isLazy = this.isServerLazy(serverName);

      lines.push(`# ${serverName}`);
      if (isLazy) {
        lines.push("Lazy:");
        for (const t of tools) {
          lines.push(`${t.name}`);
        }
      } else {
        lines.push("Eager:");
        for (const t of tools) {
          lines.push(`mcp__${serverName}__${t.name}`);
        }
      }
      lines.push("");
    }

    lines.push("For tools listed under 'Lazy', call them using the `call_mcp_tool` tool with ServerName, ToolName, and Arguments.");
    lines.push("To view parameter schema for a lazy tool, call `get_mcp_tool_schema` with ServerName and ToolName.");
    lines.push("</mcp_servers>");

    return lines.join("\n");
  }

  /**
   * Saves a server configuration to a target JSON file (e.g. .mcp.json)
   */
  saveServerToConfigFile(filePath: string, name: string, config: McpServerConfig): void {
    const fullPath = resolve(filePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let existing: McpServersConfigFile = { mcpServers: {} };
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf8");
        existing = JSON.parse(content);
        if (!existing.mcpServers) existing.mcpServers = {};
      } catch {}
    }

    existing.mcpServers[name] = config;
    writeFileSync(fullPath, JSON.stringify(existing, null, 2), "utf8");
    this.serverConfigs.set(name, config);
    this.loadedConfigFiles.add(fullPath);
  }

  /**
   * Removes a server configuration from a target JSON file
   */
  removeServerFromConfigFile(filePath: string, name: string): boolean {
    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) return false;

    try {
      const content = readFileSync(fullPath, "utf8");
      const existing: McpServersConfigFile = JSON.parse(content);
      if (existing.mcpServers && existing.mcpServers[name]) {
        delete existing.mcpServers[name];
        writeFileSync(fullPath, JSON.stringify(existing, null, 2), "utf8");
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Reloads all configuration files and refreshes ToolRouter
   */
  async reload(router?: ToolRouter): Promise<void> {
    await this.closeAll();

    if (router) {
      router.unregisterPrefix("mcp__");
      router.unregister("call_mcp_tool");
      router.unregister("get_mcp_tool_schema");
      router.unregister("list_mcp_resources");
      router.unregister("read_mcp_resource");
    }

    for (const filePath of this.loadedConfigFiles) {
      await this.loadConfigFile(filePath);
    }

    if (router) {
      this.registerToolsIntoRouter(router);
    }
  }

  /**
   * Resolves default location for saving MCP config (.mcp.json in workspace or ~/.groupy/mcp.json)
   */
  getDefaultConfigFile(cwd: string = process.cwd()): string {
    const workspaceConfig = join(cwd, ".mcp.json");
    if (existsSync(workspaceConfig)) return workspaceConfig;

    const altConfig = join(cwd, "mcp_config.json");
    if (existsSync(altConfig)) return altConfig;

    return workspaceConfig;
  }

  getLoadedConfigFiles(): string[] {
    return Array.from(this.loadedConfigFiles);
  }

  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {}
    }
    this.clients.clear();
    this.serverConfigs.clear();
  }
}
