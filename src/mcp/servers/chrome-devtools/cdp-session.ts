/**
 * CDP Session - Native Chrome DevTools Protocol Client over WebSocket.
 */

import type { ConsoleMessageRecord, NetworkRequestRecord, AxNode } from "./types";

export class CdpSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (res: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private eventListeners = new Map<string, Array<(params: any) => void>>();

  public consoleMessages: ConsoleMessageRecord[] = [];
  public networkRequests: Map<string, NetworkRequestRecord> = new Map();
  public autoHandleDialog: "accept" | "dismiss" = "accept";

  constructor(public readonly wsUrl: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        const onOpen = async () => {
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onError);

          this.setupMessageListener();

          try {
            // Enable core CDP domains
            await this.send("Page.enable");
            await this.send("Runtime.enable");
            await this.send("DOM.enable");
            await this.send("CSS.enable").catch(() => {});
            await this.send("Console.enable").catch(() => {});
            await this.send("Network.enable").catch(() => {});
            await this.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {});

            this.setupEventHandlers();
            resolve();
          } catch (err) {
            reject(err);
          }
        };

        const onError = (e: any) => {
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onError);
          reject(new Error(`WebSocket connection failed to ${this.wsUrl}`));
        };

        this.ws.addEventListener("open", onOpen);
        this.ws.addEventListener("error", onError);
      } catch (err) {
        reject(err);
      }
    });
  }

  private setupMessageListener(): void {
    if (!this.ws) return;

    this.ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data.toString());

        if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`CDP Error (${msg.error.code}): ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        } else if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          for (const listener of listeners) {
            try {
              listener(msg.params);
            } catch {}
          }
        }
      } catch {}
    });
  }

  private setupEventHandlers(): void {
    // 1. Console Messages
    this.on("Runtime.consoleAPICalled", (params) => {
      const text = (params.args || [])
        .map((a: any) => (a.value !== undefined ? String(a.value) : a.description || ""))
        .join(" ");

      this.consoleMessages.push({
        id: `console_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: params.type || "log",
        text,
        timestamp: params.timestamp || Date.now(),
        stackTrace: params.stackTrace?.callFrames,
      });

      // Keep recent 1000 messages
      if (this.consoleMessages.length > 1000) {
        this.consoleMessages.splice(0, this.consoleMessages.length - 1000);
      }
    });

    this.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails;
      this.consoleMessages.push({
        id: `exc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: "error",
        text: details?.text || details?.exception?.description || "Uncaught Exception",
        timestamp: params.timestamp || Date.now(),
        url: details?.url,
        lineNumber: details?.lineNumber,
        stackTrace: details?.stackTrace?.callFrames,
      });
    });

    // 2. Network Requests
    this.on("Network.requestWillBeSent", (params) => {
      this.networkRequests.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        resourceType: params.type || "other",
        timestamp: params.wallTime ? params.wallTime * 1000 : Date.now(),
        requestHeaders: params.request.headers,
      });
    });

    this.on("Network.responseReceived", (params) => {
      const req = this.networkRequests.get(params.requestId);
      if (req) {
        req.status = params.response.status;
        req.statusText = params.response.statusText;
        req.mimeType = params.response.mimeType;
        req.responseHeaders = params.response.headers;
      }
    });

    this.on("Network.loadingFailed", (params) => {
      const req = this.networkRequests.get(params.requestId);
      if (req) {
        req.failed = true;
        req.errorText = params.errorText;
      }
    });

    // 3. Dialog Auto-Handling
    this.on("Page.javascriptDialogOpening", async (params) => {
      try {
        await this.send("Page.handleJavaScriptDialog", {
          accept: this.autoHandleDialog === "accept",
        });
      } catch {}
    });
  }

  on(method: string, callback: (params: any) => void): () => void {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method)!.push(callback);
    return () => {
      const list = this.eventListeners.get(method) || [];
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  async send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP WebSocket is not connected");
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = 30000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.ws?.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      try {
        pending.reject(new Error("CDP Session closed"));
      } catch {}
    }
    this.pending.clear();
    this.eventListeners.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}
