/**
 * Typed error hierarchy for Groupy Core.
 */

export class GroupyError extends Error {
  constructor(
    message: string,
    public readonly code: string = "INTERNAL_ERROR",
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "GroupyError";
  }
}

export class TurnAbortedError extends GroupyError {
  constructor(message = "Turn was interrupted or aborted") {
    super(message, "TURN_ABORTED", false);
    this.name = "TurnAbortedError";
  }
}

export class ContextWindowExceededError extends GroupyError {
  constructor(message = "Model context window limit reached") {
    super(message, "CONTEXT_WINDOW_EXCEEDED", false);
    this.name = "ContextWindowExceededError";
  }
}

export class ExecutionPolicyError extends GroupyError {
  constructor(message: string) {
    super(message, "EXEC_POLICY_DENIED", false);
    this.name = "ExecutionPolicyError";
  }
}
