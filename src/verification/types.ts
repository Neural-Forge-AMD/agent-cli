/**
 * Type definitions for the Autonomous Self-Verification Subsystem.
 */

export interface VerificationResult {
  /** The command that was executed (e.g. 'bun run typecheck') */
  command: string;
  /** Whether the verification passed with exit code 0 */
  success: boolean;
  /** Process exit code */
  exitCode: number;
  /** Captured stdout and stderr output */
  output: string;
  /** Duration of the verification execution in milliseconds */
  durationMs: number;
  /** Reason for skipping or failing if applicable */
  reason?: string;
}

export interface AutoVerifierOptions {
  /** Working directory for command execution */
  cwd: string;
  /** Optional explicit verification command override */
  customCommand?: string;
  /** Execution timeout in milliseconds (default: 30000ms) */
  timeoutMs?: number;
}
