/**
 * CodeModeRuntime - High-throughput batch tool execution runtime.
 * Directly mirrors codex-rs/code-mode-runtime and codex-rs/code-mode-host.
 */

import { SandboxedWorkerHost } from "./worker-host";
import type { ToolRouter } from "../tools/router";
import type { ToolExecutionContext } from "../tools/types";
import type { CodeModeExecutionOptions, CodeModeResult } from "./types";

export class CodeModeRuntime {
  private host: SandboxedWorkerHost;

  constructor(private router: ToolRouter) {
    this.host = new SandboxedWorkerHost(this.router);
  }

  /**
   * Executes a JavaScript / TypeScript snippet with full batch access to tools and isolated globals.
   */
  async execute(
    options: CodeModeExecutionOptions,
    context: ToolExecutionContext
  ): Promise<CodeModeResult> {
    return this.host.executeCode(options, context);
  }
}
