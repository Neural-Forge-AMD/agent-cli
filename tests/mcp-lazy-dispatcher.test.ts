import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpManager } from "../src/mcp/manager";
import { McpClient } from "../src/mcp/client";
import { ToolRouter } from "../src/tools/router";
import { Session } from "../src/session/session";
import { ModelClient } from "../src/client/model-client";
import type { McpTransport } from "../src/mcp/transport";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../src/mcp/types";
import type { ModelClientSession, ModelSamplingParams, StreamChunkEvent } from "../src";

// Mock Transport returning customizable tools list
class MockMcpTransport implements McpTransport {
  constructor(private toolCount: number) {}

  async start(): Promise<void> {}
  async close(): Promise<void> {}
  onNotification(_callback: (notification: JsonRpcNotification) => void): void {}

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "mock-mcp-server", version: "1.0.0" },
          capabilities: { tools: {}, resources: {} },
        },
      };
    }

    if (request.method === "tools/list") {
      const tools = Array.from({ length: this.toolCount }, (_, i) => ({
        name: `tool_operation_${i + 1}`,
        description: `Perform operation number ${i + 1}`,
        inputSchema: {
          type: "object",
          properties: {
            inputVal: { type: "string", description: "Input value" },
          },
          required: ["inputVal"],
        },
      }));

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { tools },
      };
    }

    if (request.method === "tools/call") {
      const params = request.params as any;
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: `Executed ${params.name} with inputVal=${params.arguments?.inputVal}`,
            },
          ],
        },
      };
    }

    return { jsonrpc: "2.0", id: request.id, result: {} };
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {}
}

describe("MCP Lazy-Loading Meta Dispatcher Subsystem (Antigravity/Codex)", () => {
  let testWorkspace: string;
  let mcpManager: McpManager;
  let tools: ToolRouter;

  beforeEach(() => {
    testWorkspace = join(tmpdir(), `pikaa_mcp_lazy_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(testWorkspace, { recursive: true });
    mcpManager = new McpManager();
    tools = new ToolRouter();
  });

  afterEach(async () => {
    await mcpManager.closeAll();
    try {
      if (existsSync(testWorkspace)) {
        rmSync(testWorkspace, { recursive: true, force: true });
      }
    } catch {}
  });

  it("should eager-load servers with <= 8 tools directly into ToolRouter", async () => {
    // Register small server (3 tools)
    const smallClient = new McpClient("small_db", new MockMcpTransport(3));
    await smallClient.connect();
    (mcpManager as any).clients.set("small_db", smallClient);
    (mcpManager as any).serverConfigs.set("small_db", { type: "stdio", command: "test" });

    mcpManager.registerToolsIntoRouter(tools);

    expect(mcpManager.isServerLazy("small_db")).toBe(false);

    // Tools should be directly registered as eager functions
    expect(tools.has("mcp__small_db__tool_operation_1")).toBe(true);
    expect(tools.has("mcp__small_db__tool_operation_2")).toBe(true);
    expect(tools.has("mcp__small_db__tool_operation_3")).toBe(true);

    // call_mcp_tool meta-dispatcher is also registered
    expect(tools.has("call_mcp_tool")).toBe(true);
  });

  it("should lazy-load servers with > 8 tools to prevent context window bloat", async () => {
    // Register large server (25 tools)
    const largeClient = new McpClient("large_github", new MockMcpTransport(25));
    await largeClient.connect();
    (mcpManager as any).clients.set("large_github", largeClient);
    (mcpManager as any).serverConfigs.set("large_github", { type: "stdio", command: "test" });

    mcpManager.registerToolsIntoRouter(tools);

    expect(mcpManager.isServerLazy("large_github")).toBe(true);

    // Individual tools should NOT be registered as separate functions in ToolRouter
    expect(tools.has("mcp__large_github__tool_operation_1")).toBe(false);
    expect(tools.has("mcp__large_github__tool_operation_25")).toBe(false);

    // Only the meta tools should exist
    expect(tools.has("call_mcp_tool")).toBe(true);
    expect(tools.has("get_mcp_tool_schema")).toBe(true);

    // Verify formatMcpPrompt categorizes tools into Lazy list
    const prompt = mcpManager.formatMcpPrompt();
    expect(prompt).toContain("<mcp_servers>");
    expect(prompt).toContain("# large_github");
    expect(prompt).toContain("Lazy:");
    expect(prompt).toContain("tool_operation_1");
    expect(prompt).toContain("tool_operation_25");
    expect(prompt).toContain("call_mcp_tool");
  });

  it("should execute lazy tool via call_mcp_tool dispatcher", async () => {
    const largeClient = new McpClient("cloud_api", new MockMcpTransport(20));
    await largeClient.connect();
    (mcpManager as any).clients.set("cloud_api", largeClient);
    (mcpManager as any).serverConfigs.set("cloud_api", { type: "stdio", command: "test" });

    mcpManager.registerToolsIntoRouter(tools);

    const callTool = tools.get("call_mcp_tool")!;
    expect(callTool).toBeDefined();

    const result = await callTool.execute({
      ServerName: "cloud_api",
      ToolName: "tool_operation_14",
      Arguments: { inputVal: "hello_world" },
    }, {} as any);

    expect(result.output).toContain("Executed tool_operation_14 with inputVal=hello_world");

    // Test get_mcp_tool_schema
    const schemaTool = tools.get("get_mcp_tool_schema")!;
    const schemaResult = await schemaTool.execute({
      ServerName: "cloud_api",
      ToolName: "tool_operation_14",
    }, {} as any);

    const parsedSchema = JSON.parse(schemaResult.output);
    expect(parsedSchema.name).toBe("tool_operation_14");
    expect(parsedSchema.inputSchema.properties.inputVal).toBeDefined();
  });

  it("should allow LLM to invoke call_mcp_tool during end-to-end Session ReAct loop", async () => {
    const largeClient = new McpClient("postgres_server", new MockMcpTransport(15));
    await largeClient.connect();
    (mcpManager as any).clients.set("postgres_server", largeClient);
    (mcpManager as any).serverConfigs.set("postgres_server", { type: "stdio", command: "test" });

    mcpManager.registerToolsIntoRouter(tools);

    class MockMcpModelClient extends ModelClient {
      override newSession(): ModelClientSession {
        return {
          async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
            const lastItem = params.history[params.history.length - 1];

            if (lastItem && lastItem.type === "function_call_output") {
              yield {
                type: "text_delta",
                delta: `Database query result: ${lastItem.output}`,
              };
              yield { type: "done" };
              return;
            }

            // Step 1: Model calls lazy MCP tool via call_mcp_tool meta-dispatcher
            yield {
              type: "tool_call",
              callId: "call_lazy_1",
              name: "call_mcp_tool",
              arguments: {
                ServerName: "postgres_server",
                ToolName: "tool_operation_5",
                Arguments: { inputVal: "SELECT * FROM users" },
              },
            };
            yield { type: "done" };
          },
        };
      }
    }

    const session = new Session({
      cwd: testWorkspace,
      tools,
      mcpManager,
      modelClient: new MockMcpModelClient(),
    });

    let completedText = "";
    session.onEvent((event) => {
      if (event.msg.type === "AgentMessageDelta") {
        completedText += event.msg.delta;
      }
    });

    await session.prompt("Query the database for all users");

    await new Promise<void>((resolve) => {
      const unsub = session.onEvent((evt) => {
        if (evt.msg.type === "TurnCompleted") {
          unsub();
          resolve();
        }
      });
    });

    expect(completedText).toContain("Database query result");
    expect(completedText).toContain("Executed tool_operation_5 with inputVal=SELECT * FROM users");
  }, 15000);
});
