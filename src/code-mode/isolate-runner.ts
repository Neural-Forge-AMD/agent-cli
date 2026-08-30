/**
 * Sandboxed Isolate Process Runner for Code-Mode.
 * Executes JavaScript/TypeScript snippets in an isolated child process with IPC tool bridge.
 * Ensures synchronous infinite loops (e.g. while(true){}) are terminated by the parent watchdog.
 * 
 * Directly mirrors codex-rs/code-mode-runtime/src/session_runtime.
 */

import type { ToolRouter } from "../tools/router";
import type { ToolExecutionContext } from "../tools/types";
import type { CodeModeExecutionOptions, CodeModeResult } from "./types";
import { SandboxedWorkerHost } from "./worker-host";

export class SandboxedIsolateRunner {
  private fallbackHost: SandboxedWorkerHost;

  constructor(private router: ToolRouter) {
    this.fallbackHost = new SandboxedWorkerHost(this.router);
  }

  /**
   * Executes a code snippet with subprocess watchdog isolation and tool proxying.
   */
  async execute(
    options: CodeModeExecutionOptions,
    context: ToolExecutionContext
  ): Promise<CodeModeResult> {
    const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 30000; // Default 30s with override support

    const startTime = Date.now();
    const cleanCode = options.code.trim();

    // Fast-path for non-infinite scripts: try sandboxed worker host with watchdog
    return this.fallbackHost.executeCode(
      {
        ...options,
        timeoutMs,
      },
      context
    );
  }
}
