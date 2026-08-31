/**
 * MCP Transports: Stdio & SSE Transport implementations.
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
} from "./types";
import { GroupyError } from "../protocol/errors";
import { GlobalProcessRegistry } from "./process-killer";

export interface McpTransport {
  start(): Promise<void>;
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  sendNotification(notification: JsonRpcNotification): Promise<void>;
  onNotification(handler: (notif: JsonRpcNotification) => void): void;
  close(): Promise<void>;
}

/**
 * Stdio Transport
 * Runs an external MCP server process using Bun.spawn and communicates over stdin/stdout.
 */
export class StdioTransport implements McpTransport {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (res: JsonRpcResponse) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private notificationHandlers: Array<(notif: JsonRpcNotification) => void> = [];
  private isClosed = false;

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
    private cwd?: string
  ) {}

  async start(): Promise<void> {
    const fullCmd = [this.command, ...this.args];
    try {
      this.proc = Bun.spawn(fullCmd, {
        cwd: this.cwd || process.cwd(),
        env: { ...process.env, ...this.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      if (this.proc && this.proc.pid) {
        GlobalProcessRegistry.register(this.proc.pid, fullCmd.join(" "), () => this.close());
      }

      this.readStdoutLoop();
      this.readStderrLoop();
    } catch (err) {
      throw new GroupyError(
        `Failed to spawn MCP stdio server '${this.command}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async readStdoutLoop(): Promise<void> {
    if (!this.proc || !this.proc.stdout) return;
    const stdout = this.proc.stdout as any;
    if (!stdout || typeof stdout.getReader !== "function") return;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (!this.isClosed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const message: JsonRpcMessage = JSON.parse(trimmed);

            // Handle response
            if ("id" in message && message.id !== undefined && message.id !== null) {
              const pending = this.pendingRequests.get(message.id);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(message.id);
                pending.resolve(message as JsonRpcResponse);
              }
            } else if ("method" in message) {
              // Handle notification
              for (const handler of this.notificationHandlers) {
                handler(message as JsonRpcNotification);
              }
            }
          } catch {
            // Ignore malformed non-JSON lines on stdout
          }
        }
      }
    } catch {
      // Process stdout closed
    }
  }

  private async readStderrLoop(): Promise<void> {
    if (!this.proc || !this.proc.stderr) return;
    const stderr = this.proc.stderr as any;
    if (!stderr || typeof stderr.getReader !== "function") return;
    const reader = stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (!this.isClosed) {
        const { done, value } = await reader.read();
        if (done) break;
        const errText = decoder.decode(value);
        if (process.env.DEBUG_MCP) {
          console.error(`[MCP Stdio Stderr]: ${errText}`);
        }
      }
    } catch {
      // Stderr closed
    }
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.isClosed || !this.proc || !this.proc.stdin) {
      throw new GroupyError("MCP Stdio transport is closed");
    }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeoutMs = 30000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new GroupyError(`MCP request timed out after ${timeoutMs}ms (method: ${request.method})`));
      }, timeoutMs);

      this.pendingRequests.set(request.id, { resolve, reject, timer });

      try {
        const payload = JSON.stringify(request) + "\n";
        const stdin = this.proc?.stdin as any;
        if (stdin && typeof stdin.write === "function") {
          stdin.write(payload);
          if (typeof stdin.flush === "function") stdin.flush();
        }
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(request.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (this.isClosed || !this.proc || !this.proc.stdin) return;
    const payload = JSON.stringify(notification) + "\n";
    const stdin = this.proc?.stdin as any;
    if (stdin && typeof stdin.write === "function") {
      stdin.write(payload);
      if (typeof stdin.flush === "function") stdin.flush();
    }
  }

  onNotification(handler: (notif: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.isClosed = true;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      try {
        pending.reject(new GroupyError("MCP transport closed"));
      } catch {}
    }
    this.pendingRequests.clear();

    if (this.proc) {
      const pid = this.proc.pid;
      try {
        this.proc.kill();
      } catch {}

      if (pid) {
        GlobalProcessRegistry.killProcessTree(pid);
        GlobalProcessRegistry.unregister(pid);
      }
      this.proc = null;
    }
  }
}

/**
 * SSE Transport
 * Connects to an HTTP Server-Sent Events MCP endpoint.
 */
export class SseTransport implements McpTransport {
  private endpointUrl: string;
  private messageUrl: string | null = null;
  private abortController = new AbortController();
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (res: JsonRpcResponse) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private notificationHandlers: Array<(notif: JsonRpcNotification) => void> = [];
  private isClosed = false;

  constructor(
    url: string,
    private headers: Record<string, string> = {}
  ) {
    this.endpointUrl = url;
  }

  async start(): Promise<void> {
    const response = await fetch(this.endpointUrl, {
      headers: {
        Accept: "text/event-stream",
        ...this.headers,
      },
      signal: this.abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new GroupyError(`Failed to connect to MCP SSE endpoint (${this.endpointUrl}): HTTP ${response.status}`);
    }

    this.readSseStream(response.body);
  }

  private async readSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (!this.isClosed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const lines = eventBlock.split("\n");
          let eventType = "message";
          let eventData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              eventData += line.slice(6).trim();
            }
          }

          if (eventType === "endpoint" && eventData) {
            // Relative or absolute URL for sending JSON-RPC POST messages
            this.messageUrl = new URL(eventData, this.endpointUrl).toString();
          } else if (eventType === "message" && eventData) {
            try {
              const msg: JsonRpcMessage = JSON.parse(eventData);
              if ("id" in msg && msg.id !== undefined && msg.id !== null) {
                const pending = this.pendingRequests.get(msg.id);
                if (pending) {
                  clearTimeout(pending.timer);
                  this.pendingRequests.delete(msg.id);
                  pending.resolve(msg as JsonRpcResponse);
                }
              } else if ("method" in msg) {
                for (const handler of this.notificationHandlers) {
                  handler(msg as JsonRpcNotification);
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.messageUrl) {
      // Default to POSTing directly to the endpoint URL if no endpoint event was sent
      this.messageUrl = this.endpointUrl;
    }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new GroupyError(`MCP SSE request timed out (method: ${request.method})`));
      }, 30000);

      this.pendingRequests.set(request.id, { resolve, reject, timer });

      fetch(this.messageUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      }).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(request.id);
        reject(err);
      });
    });
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    if (!this.messageUrl) return;
    await fetch(this.messageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(notification),
      signal: this.abortController.signal,
    });
  }

  onNotification(handler: (notif: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.isClosed = true;
    this.abortController.abort();
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new GroupyError("MCP SSE transport closed"));
    }
    this.pendingRequests.clear();
  }
}
