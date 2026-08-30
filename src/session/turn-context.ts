/**
 * TurnContext holds the per-turn state and environment snapshot.
 * Mirrors TurnContext in codex-rs/core/session/turn_context.rs.
 */

import type { ToolRouter } from "../tools/router";

export interface TurnEnvironment {
  cwd: string;
}

export class TurnContext {
  public readonly abortController: AbortController;
  public readonly createdAt: number;

  constructor(
    public readonly turnId: string,
    public readonly model: string,
    public readonly tools: ToolRouter,
    public readonly environment: TurnEnvironment,
    public readonly maxIterations = 250
  ) {
    this.abortController = new AbortController();
    this.createdAt = Date.now();
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  abort(reason = "Turn aborted by user or system"): void {
    this.abortController.abort(new Error(reason));
  }
}
