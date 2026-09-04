/**
 * Sandboxed Worker Host for Code-Mode Runtime.
 * Executes JavaScript/TypeScript snippets in an environment with stripped global access.
 * 
 * Directly mirrors codex-rs/code-mode-runtime/src/session_runtime.
 */

import { CodeModeToolsProxy } from "./tools-proxy";
import type { ToolRouter } from "../tools/router";
import type { ToolExecutionContext } from "../tools/types";
import type { CodeModeExecutionOptions, CodeModeResult } from "./types";

export class SandboxedWorkerHost {
  constructor(private router: ToolRouter) {}

  /**
   * Executes code with sanitized globals, watchdog timeout, and tool proxies.
   */
  async executeCode(
    options: CodeModeExecutionOptions,
    context: ToolExecutionContext
  ): Promise<CodeModeResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const timeoutMs = options.timeoutMs || 30000;

    const toolsManager = new CodeModeToolsProxy(this.router, context, logs, {
      maxToolCalls: options.maxToolCalls || 50,
    });

    const toolsProxy = toolsManager.createProxy();
    const customConsole = toolsManager.createConsole();
    const textFn = toolsManager.text.bind(toolsManager);
    const storeFn = toolsManager.store.bind(toolsManager);
    const loadFn = toolsManager.load.bind(toolsManager);

    // Strip markdown code fences if LLM accidentally wrapped code in ```js or ```ts
    let cleanCode = options.code.trim();
    if (cleanCode.startsWith("```")) {
      cleanCode = cleanCode
        .replace(/^```(?:javascript|js|typescript|ts)?\n?/, "")
        .replace(/\n?```$/, "");
    }

    // Transform accidental ESM import syntax from LLM into global tools destructuring
    // e.g. `import { list_dir, read_file } from "tools";` -> `const { list_dir, read_file } = tools;`
    cleanCode = cleanCode.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, imported) => {
      return `const { ${imported} } = tools;`;
    });
    cleanCode = cleanCode.replace(/import\s*\*\s*as\s+(\w+)\s+from\s*['"][^'"]+['"];?/g, (_, varName) => {
      return varName === "tools" ? "" : `const ${varName} = tools;`;
    });
    cleanCode = cleanCode.replace(/import\s+(\w+)\s+from\s*['"][^'"]+['"];?/g, (_, varName) => {
      return varName === "tools" ? "" : `const ${varName} = tools;`;
    });
    cleanCode = cleanCode.replace(/import\s*['"][^'"]+['"];?/g, "");

    // Shadow dangerous runtime globals inside the execution wrapper
    const wrappedScript = `
      "use strict";
      const process = undefined;
      const Bun = undefined;
      const require = undefined;
      const fetch = undefined;
      const XMLHttpRequest = undefined;
      const WebSocket = undefined;
      const globalThis = Object.freeze(Object.create(null));
      const global = undefined;
      const window = undefined;
      
      return (async () => {
        ${cleanCode}
      })();
    `;

    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(
        "tools",
        "text",
        "store",
        "load",
        "console",
        wrappedScript
      );

      const executionPromise = fn(
        toolsProxy,
        textFn,
        storeFn,
        loadFn,
        customConsole
      );

      let timeoutTimer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error(`Code-Mode execution timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      });

      // Handle abort signal
      if (context.signal) {
        context.signal.addEventListener("abort", () => {
          clearTimeout(timeoutTimer);
        });
      }

      const rawResult = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timeoutTimer);

      if (rawResult !== undefined && rawResult !== null) {
        textFn(rawResult);
      }

      const durationMs = Date.now() - startTime;
      return {
        success: true,
        output: logs.join("\n") || "[Code-Mode execution completed successfully with no output]",
        logs,
        toolCallsCount: toolsManager.getToolCallCount(),
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: logs.join("\n") + (logs.length > 0 ? "\n" : "") + `[Execution Error] ${errorMsg}`,
        logs,
        toolCallsCount: toolsManager.getToolCallCount(),
        error: errorMsg,
        durationMs,
      };
    }
  }
}
