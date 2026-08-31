/**
 * Code-Mode Batch Execution Types & Definitions.
 * Directly mirrors codex-rs/code-mode and codex-rs/code-mode-protocol.
 */

export interface CodeModeExecutionOptions {
  code: string;
  timeoutMs?: number;
  maxMemoryMb?: number;
  maxToolCalls?: number;
}

export interface CodeModeResult {
  success: boolean;
  output: string;
  logs: string[];
  toolCallsCount: number;
  error?: string;
  durationMs: number;
}
