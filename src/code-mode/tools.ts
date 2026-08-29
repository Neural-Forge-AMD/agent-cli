/**
 * Code-Mode LLM Tools for Batch Execution.
 * Directly mirrors codex-rs/code-mode-protocol and codex-rs/core/src/tools/handlers/code_mode.rs.
 */

import type { Tool } from "../tools/types";
import type { ToolRouter } from "../tools/router";
import { CodeModeRuntime } from "./runtime";

export function createCodeModeTools(router: ToolRouter): Tool[] {
  const runtime = new CodeModeRuntime(router);

  const codeModeTool: Tool = {
    name: "code_mode",
    description:
      "Execute JavaScript/TypeScript code to orchestrate and batch multiple tool calls in a single turn without waiting for multiple LLM round-trips. " +
      "All workspace tools are available on the global `tools` object as async functions, e.g. `await tools.read_file({ path: '...' })`, `await tools.apply_patch({ path: '...', patch: '...' })`, `await tools.grep_search({ query: '...' })`, `await tools.find_files({ pattern: '...' })`, `await tools.shell({ command: '...' })`. " +
      "You can also use global helpers: `text(msg)` or `console.log(msg)` to emit output, `store(k, v)` and `load(k)` to persist state across batch runs.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute asynchronously.",
        },
        timeout_ms: {
          type: "number",
          description: "Maximum execution timeout in milliseconds (default: 30000ms).",
        },
      },
      required: ["code"],
    },
    async execute(args, context) {
      const code = String(args.code || "");
      if (!code.trim()) {
        return { output: "Error: code parameter cannot be empty.", isError: true };
      }

      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 30000;

      const result = await runtime.execute({ code, timeoutMs }, context);

      return {
        output: result.output,
        isError: !result.success,
      };
    },
  };

  return [codeModeTool];
}
