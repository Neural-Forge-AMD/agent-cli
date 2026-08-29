/**
 * CodeModeRuntime - High-throughput batch tool execution runtime.
 * Directly mirrors codex-rs/code-mode-runtime and codex-rs/code-mode-host.
 */

import type { ToolRouter } from "../tools/router";
import type { ToolExecutionContext } from "../tools/types";
import type { CodeModeExecutionOptions, CodeModeResult } from "./types";

export class CodeModeRuntime {
  private memoryStore = new Map<string, any>();

  constructor(private router: ToolRouter) {}

  /**
   * Executes a JavaScript / TypeScript snippet with full batch access to tools
   */
  async execute(
    options: CodeModeExecutionOptions,
    context: ToolExecutionContext
  ): Promise<CodeModeResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const timeoutMs = options.timeoutMs || 30000;

    // 1. Build dynamic tools proxy
    const toolsProxy = new Proxy(
      {},
      {
        get: (_, prop: string) => {
          return async (args: any = {}) => {
            // Normalize camelCase to snake_case (e.g. readFile -> read_file)
            const normalizedName = this.normalizeToolName(prop);

            const tool = this.router.get(normalizedName) || this.router.get(prop);
            if (!tool) {
              throw new Error(`Tool '${prop}' (normalized: '${normalizedName}') is not registered in ToolRouter.`);
            }

            const res = await this.router.execute(tool.name, args, context);
            if (res.isError) {
              throw new Error(`Tool '${tool.name}' failed: ${res.output}`);
            }

            return res.output;
          };
        },
      }
    );

    // 2. Global sandbox helpers
    const text = (val: any) => {
      const formatted = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      logs.push(formatted);
    };

    const store = (key: string, value: any) => {
      this.memoryStore.set(key, value);
    };

    const load = (key: string) => {
      return this.memoryStore.get(key);
    };

    const customConsole = {
      log: (...args: any[]) => {
        logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      },
      error: (...args: any[]) => {
        logs.push("[ERROR] " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      },
      warn: (...args: any[]) => {
        logs.push("[WARN] " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
      },
    };

    // Strip markdown code fences if LLM accidentally wrapped code in ```js or ```ts
    let cleanCode = options.code.trim();
    if (cleanCode.startsWith("```")) {
      cleanCode = cleanCode.replace(/^```(?:javascript|js|typescript|ts)?\n?/, "").replace(/\n?```$/, "");
    }

    // 3. Construct async execution wrapper
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(
        "tools",
        "text",
        "store",
        "load",
        "console",
        `
        "use strict";
        ${cleanCode}
        `
      );

      const executionPromise = fn(toolsProxy, text, store, load, customConsole);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Code execution timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);

      let finalOutput = logs.join("\n");
      if (result !== undefined) {
        const resStr = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
        finalOutput = finalOutput ? `${finalOutput}\n\n[Returned Value]: ${resStr}` : resStr;
      }

      return {
        success: true,
        output: finalOutput || "[Code executed successfully with no output]",
        logs,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: logs.length > 0 ? `${logs.join("\n")}\n\n[Execution Error]: ${errorMessage}` : `[Execution Error]: ${errorMessage}`,
        logs,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private normalizeToolName(name: string): string {
    return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}
