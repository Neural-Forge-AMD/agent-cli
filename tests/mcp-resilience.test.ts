import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StdioTransport } from "../src/mcp/transport";
import { GlobalProcessRegistry } from "../src/mcp/process-killer";
import { McpManager } from "../src/mcp/manager";

describe("MCP Resilience & Process Lifecycle Cleanup Subsystem", () => {
  afterEach(async () => {
    GlobalProcessRegistry.killAll();
  });

  it("should register active child process PID in GlobalProcessRegistry when spawned", async () => {
    // Spawn a persistent child process (e.g., node / bun sleep)
    const transport = new StdioTransport(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000);",
    ]);

    await transport.start();

    const trackedPids = GlobalProcessRegistry.getTrackedPids();
    expect(trackedPids.length).toBeGreaterThanOrEqual(1);

    const childPid = (transport as any).proc?.pid;
    expect(childPid).toBeDefined();
    expect(trackedPids).toContain(childPid);

    // Close transport
    await transport.close();

    // After closing, PID should be unregistered from GlobalProcessRegistry
    expect(GlobalProcessRegistry.getTrackedPids()).not.toContain(childPid);
  });

  it("should terminate all child processes unconditionally when GlobalProcessRegistry.killAll() is called", async () => {
    const transport1 = new StdioTransport(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000);",
    ]);
    const transport2 = new StdioTransport(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000);",
    ]);

    await transport1.start();
    await transport2.start();

    const pid1 = (transport1 as any).proc?.pid;
    const pid2 = (transport2 as any).proc?.pid;

    expect(GlobalProcessRegistry.getTrackedPids()).toContain(pid1);
    expect(GlobalProcessRegistry.getTrackedPids()).toContain(pid2);

    // Call killAll()
    GlobalProcessRegistry.killAll();

    expect(GlobalProcessRegistry.getTrackedPids().length).toBe(0);
  });

  it("should kill process tree safely without throwing on invalid or already-dead PIDs", () => {
    expect(() => {
      GlobalProcessRegistry.killProcessTree(-1);
      GlobalProcessRegistry.killProcessTree(99999999);
    }).not.toThrow();
  });

  it("should clean up all active transports and processes via McpManager.closeAll()", async () => {
    const manager = new McpManager();

    // Register a real stdio server that responds to MCP discovery requests
    const serverScript = `
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on("line", (line) => {
        try {
          const req = JSON.parse(line);
          if (!req.id) return;
          if (req.method === "initialize") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "test-mcp" } }
            }) + "\\n");
          } else if (req.method === "tools/list") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [] } }) + "\\n");
          } else if (req.method === "resources/list") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { resources: [] } }) + "\\n");
          } else if (req.method === "prompts/list") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { prompts: [] } }) + "\\n");
          } else {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }) + "\\n");
          }
        } catch (e) {}
      });
      setInterval(() => {}, 1000);
    `;

    await manager.registerServer("worker", {
      type: "stdio",
      command: process.execPath,
      args: ["-e", serverScript],
      lazy: false,
    });

    const client = manager.getClient("worker");
    expect(client).toBeDefined();

    expect(GlobalProcessRegistry.getTrackedPids().length).toBeGreaterThanOrEqual(1);

    await manager.closeAll();

    expect(manager.listServers().length).toBe(0);
    expect(GlobalProcessRegistry.getTrackedPids().length).toBe(0);
  });
});
