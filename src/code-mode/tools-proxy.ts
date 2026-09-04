/**
 * Dynamic Batch Tools Proxy for Code-Mode Runtime.
 * Translates method calls into ToolRouter executions with camelCase normalization,
 * concurrency management, and memory storage.
 * 
 * Directly mirrors codex-rs/code-mode-host/src/runtime.
 */

import type { ToolRouter } from "../tools/router";
import type { ToolExecutionContext } from "../tools/types";

export interface ToolsProxyOptions {
  maxToolCalls?: number;
  onToolCall?: (name: string, args: any) => void;
}

export class CodeModeToolsProxy {
  private memoryStore = new Map<string, any>();
  private toolCallCount = 0;
  private maxToolCalls: number;

  constructor(
    private router: ToolRouter,
    private context: ToolExecutionContext,
    private logs: string[],
    options: ToolsProxyOptions = {}
  ) {
    this.maxToolCalls = options.maxToolCalls || 50;
  }

  /**
   * Normalizes camelCase identifier to snake_case (e.g., readFile -> read_file).
   */
  private normalizeToolName(name: string): string {
    return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /**
   * Creates the proxy object injected as `tools` into the sandboxed script.
   */
  createProxy(): Record<string, any> {
    return new Proxy(
      {},
      {
        get: (_, prop: string) => {
          return async (args: any = {}) => {
            if (this.toolCallCount >= this.maxToolCalls) {
              throw new Error(
                `Code-Mode Quota Exceeded: reached maximum tool calls limit (${this.maxToolCalls}).`
              );
            }

            this.toolCallCount++;
            const normalizedName = this.normalizeToolName(prop);
            const tool = this.router.get(normalizedName) || this.router.get(prop);

            if (!tool) {
              throw new Error(
                `Tool '${prop}' (normalized: '${normalizedName}') is not registered in ToolRouter.`
              );
            }

            const result = await this.router.execute(tool.name, args, this.context);
            if (result.isError) {
              throw new Error(`Tool '${tool.name}' failed: ${result.output}`);
            }

            if (
              normalizedName === "write_file" ||
              normalizedName === "apply_patch" ||
              tool.name === "write_file" ||
              tool.name === "apply_patch"
            ) {
              const pathArg = String(args?.path || "");
              if (pathArg) {
                this.context.onFileModified?.(pathArg);
              }
            }

            return result.output;
          };
        },
      }
    );
  }

  /**
   * Global `text(...)` helper to append formatted data to output.
   */
  text(val: any): void {
    const formatted = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
    this.logs.push(formatted);
  }

  /**
   * Cross-cell persistent memory storage helper.
   */
  store(key: string, value: any): void {
    this.memoryStore.set(key, value);
  }

  /**
   * Cross-cell persistent memory retrieval helper.
   */
  load(key: string): any {
    return this.memoryStore.get(key);
  }

  /**
   * Custom sandboxed console implementation.
   */
  createConsole(): any {
    return {
      log: (...args: any[]) => {
        this.logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      },
      error: (...args: any[]) => {
        this.logs.push("[ERROR] " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      },
      warn: (...args: any[]) => {
        this.logs.push("[WARN] " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      },
    };
  }

  getToolCallCount(): number {
    return this.toolCallCount;
  }
}
