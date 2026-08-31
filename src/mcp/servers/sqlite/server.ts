/**
 * Local SQLite & Database Inspector MCP Server - JSON-RPC 2.0 stdio server implementation.
 * Aligned with MCP Specification (2024-11-05).
 */

import { createInterface } from "node:readline";
import { SqliteEngine } from "./db-engine";
import { getSqliteToolSchemas, executeSqliteTool } from "./tools";
import type { JsonRpcRequest, JsonRpcResponse } from "../../types";

export class SqliteMcpServer {
  private engine: SqliteEngine;
  private tools = getSqliteToolSchemas();

  constructor(defaultDbPath?: string) {
    this.engine = new SqliteEngine(defaultDbPath);
  }

  async start(): Promise<void> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req: JsonRpcRequest = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + "\n");
        }
      } catch (err) {
        const errResponse: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32700,
            message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
        process.stdout.write(JSON.stringify(errResponse) + "\n");
      }
    });

    const cleanup = () => {
      this.engine.closeAll();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("exit", cleanup);
  }

  close(): void {
    this.engine.closeAll();
  }

  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { id, method, params } = req;

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: "sqlite-local-mcp",
            version: "1.0.0",
          },
        },
      };
    }

    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: this.tools,
        },
      };
    }

    if (method === "tools/call") {
      const toolName = String((params as any)?.name);
      const args = (params as any)?.arguments || {};

      try {
        const output = await executeSqliteTool(this.engine, toolName, args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: typeof output === "string" ? output : JSON.stringify(output, null, 2),
              },
            ],
          },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    if (method === "resources/list") {
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    }

    if (method === "prompts/list") {
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }
}

// If invoked as a CLI executable directly:
if (import.meta.main) {
  const dbArg = process.argv[2];
  const server = new SqliteMcpServer(dbArg);
  server.start().catch((err) => {
    console.error("Failed to start SQLite MCP Server:", err);
    process.exit(1);
  });
}
