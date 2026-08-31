/**
 * McpClient - Connects to an individual MCP Server.
 * Handles lifecycle handshake, tool discovery, tool calling, and resource reading.
 * 
 * Mirrors codex-rs/codex-mcp and rmcp-client.
 */

import type { McpTransport } from "./transport";
import type {
  McpInitializeResult,
  McpToolSchema,
  McpListToolsResult,
  McpCallToolResult,
  McpResource,
  McpListResourcesResult,
  McpReadResourceResult,
  McpPrompt,
  McpListPromptsResult,
  McpGetPromptResult,
} from "./types";
import { GroupyError } from "../protocol/errors";

export class McpClient {
  private nextRequestId = 1;
  private serverInfo: McpInitializeResult["serverInfo"] | null = null;
  private capabilities: McpInitializeResult["capabilities"] | null = null;
  private tools: McpToolSchema[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];

  constructor(
    public readonly name: string,
    private transport: McpTransport
  ) {}

  isConnected(): boolean {
    return this.serverInfo !== null;
  }

  async connect(): Promise<void> {
    await this.transport.start();

    // 1. Initialize Handshake
    const initResponse = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {
          roots: { listChanged: false },
          sampling: {},
        },
        clientInfo: {
          name: "groupy",
          version: "0.1.0",
        },
      },
    });

    if (initResponse.error) {
      throw new GroupyError(
        `MCP Initialize failed for server '${this.name}': ${initResponse.error.message}`
      );
    }

    const initResult = initResponse.result as McpInitializeResult;
    this.serverInfo = initResult.serverInfo;
    this.capabilities = initResult.capabilities || {};

    // 2. Initialized Notification
    await this.transport.sendNotification({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // 3. Discover Available Tools
    await this.refreshTools();

    // 4. Discover Resources (if supported)
    if (this.capabilities.resources) {
      try {
        await this.refreshResources();
      } catch {}
    }

    // 5. Discover Prompts (if supported)
    if (this.capabilities.prompts) {
      try {
        await this.refreshPrompts();
      } catch {}
    }
  }

  // --- Tools ---

  async refreshTools(): Promise<McpToolSchema[]> {
    const response = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "tools/list",
      params: {},
    });

    if (response.error) {
      throw new GroupyError(
        `Failed to list tools from MCP server '${this.name}': ${response.error.message}`
      );
    }

    const result = response.result as McpListToolsResult;
    this.tools = result.tools || [];
    return this.tools;
  }

  getTools(): McpToolSchema[] {
    return [...this.tools];
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ output: string; isError?: boolean }> {
    const response = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    });

    if (response.error) {
      return {
        output: `MCP Server Error: ${response.error.message}`,
        isError: true,
      };
    }

    const result = response.result as McpCallToolResult;
    const textOutputs: string[] = [];

    for (const item of result.content || []) {
      if (item.type === "text" && item.text) {
        textOutputs.push(item.text);
      } else if (item.type === "resource" && item.text) {
        textOutputs.push(item.text);
      } else if (item.type === "image") {
        textOutputs.push(`[Image content: ${item.mimeType || "image/png"}]`);
      }
    }

    return {
      output: textOutputs.join("\n") || "[Tool executed with empty content]",
      isError: result.isError,
    };
  }

  // --- Resources ---

  async refreshResources(): Promise<McpResource[]> {
    const response = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "resources/list",
      params: {},
    });

    if (!response.error && response.result) {
      const result = response.result as McpListResourcesResult;
      this.resources = result.resources || [];
    }
    return this.resources;
  }

  getResources(): McpResource[] {
    return [...this.resources];
  }

  async readResource(uri: string): Promise<{ contents: string; mimeType?: string }> {
    const response = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "resources/read",
      params: { uri },
    });

    if (response.error) {
      throw new GroupyError(`Failed to read MCP resource '${uri}': ${response.error.message}`);
    }

    const result = response.result as McpReadResourceResult;
    const item = result.contents?.[0];
    return {
      contents: item?.text || item?.blob || "",
      mimeType: item?.mimeType,
    };
  }

  // --- Prompts ---

  async refreshPrompts(): Promise<McpPrompt[]> {
    const response = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "prompts/list",
      params: {},
    });

    if (!response.error && response.result) {
      const result = response.result as McpListPromptsResult;
      this.prompts = result.prompts || [];
    }
    return this.prompts;
  }

  getPrompts(): McpPrompt[] {
    return [...this.prompts];
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<McpGetPromptResult> {
    const response = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "prompts/get",
      params: { name, arguments: args },
    });

    if (response.error) {
      throw new GroupyError(`Failed to get MCP prompt '${name}': ${response.error.message}`);
    }

    return response.result as McpGetPromptResult;
  }

  getServerInfo(): McpInitializeResult["serverInfo"] | null {
    return this.serverInfo;
  }

  async ping(): Promise<{ success: boolean; durationMs: number; error?: string }> {
    const start = performance.now();
    try {
      const response = await this.transport.send({
        jsonrpc: "2.0",
        id: this.nextRequestId++,
        method: "ping",
        params: {},
      });
      const durationMs = Math.round((performance.now() - start) * 10) / 10;
      if (response.error) {
        return { success: false, durationMs, error: response.error.message };
      }
      return { success: true, durationMs };
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 10) / 10;
      return { success: false, durationMs, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
