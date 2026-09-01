/**
 * Execution Policy Engine for Groupy.
 * Directly mirrors codex-rs/core/src/exec_policy.rs.
 * 
 * Rules determine whether a command:
 * - is auto-approved (read-only / safe commands)
 * - requires interactive user confirmation
 * - is strictly denied
 */

export type ExecDecision = "allow" | "prompt" | "deny";
export type PermissionMode = "auto" | "manual" | "accept-edits" | "plan";

export interface ExecRule {
  pattern: RegExp;
  decision: ExecDecision;
  description?: string;
}

export class ExecPolicy {
  private rules: ExecRule[] = [];
  private mode: PermissionMode = "auto";

  constructor(initialMode: PermissionMode = "auto") {
    this.mode = initialMode;
    this.initDefaultRules();
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Initializes standard safe and dangerous command rules matching Codex
   */
  private initDefaultRules(): void {
    // Read-only / inspection commands -> Allow
    this.addRule(/^(git\s+(status|log|diff|branch|show|rev-parse))/i, "allow", "Safe git query");
    this.addRule(/^(ls|dir|cat|type|grep|rg|find|pwd|echo|head|tail|wc|which|where)\b/i, "allow", "Safe read-only shell command");
    this.addRule(/^(bun\s+(test|--version|-v)|npm\s+(test|--version|-v)|node\s+-v)\b/i, "allow", "Testing & runtime check");

    // Potentially dangerous commands -> Prompt user
    this.addRule(/^(rm|del|rmdir|format|mkfs)\b/i, "prompt", "Destructive file removal");
    this.addRule(/^(git\s+(push|reset\s+--hard|clean\s+-fd|rebase))\b/i, "prompt", "Destructive git operation");
    this.addRule(/^(curl|wget|fetch|ssh|scp|ftp)\b/i, "prompt", "Network / remote transfer");
  }

  addRule(pattern: RegExp, decision: ExecDecision, description?: string): void {
    this.rules.unshift({ pattern, decision, description });
  }

  /**
   * Evaluates if a file modification requires interactive user approval.
   */
  shouldPromptFileEdit(filePath?: string): { prompt: boolean; isPlanBlocked?: boolean; reason?: string } {
    if (this.mode === "plan") {
      return {
        prompt: false,
        isPlanBlocked: true,
        reason: "Plan Mode is active. Mutating files is not allowed while planning.",
      };
    }

    if (this.mode === "manual") {
      return {
        prompt: true,
        reason: `Manual mode requires approval to modify '${filePath || "file"}'`,
      };
    }

    // "auto" and "accept-edits" modes automatically approve file modifications
    return { prompt: false };
  }

  /**
   * Evaluates if a shell command can run or needs approval under the current permission mode.
   */
  evaluate(command: string): { decision: ExecDecision; reason?: string } {
    const trimmed = command.trim();

    if (this.mode === "plan") {
      // In plan mode, only allow non-mutating inspection commands
      const isReadOnly = /^(git\s+(status|log|diff|branch|show)|ls|dir|cat|type|grep|rg|find|pwd|which|where)\b/i.test(trimmed);
      if (isReadOnly) {
        return { decision: "allow", reason: "Read-only inspection allowed in Plan mode" };
      }
      return { decision: "deny", reason: "Cannot execute mutating shell commands in Plan mode" };
    }

    if (this.mode === "manual") {
      return {
        decision: "prompt",
        reason: "Manual mode requires confirmation for all shell commands",
      };
    }

    if (this.mode === "accept-edits") {
      // "accept-edits" auto-approves file edits, but prompts for shell commands (unless safe read-only)
      const isReadOnly = /^(git\s+(status|log|diff|branch|show)|ls|dir|cat|type|grep|rg|find|pwd|bun\s+test|npm\s+test)\b/i.test(trimmed);
      if (isReadOnly) {
        return { decision: "allow", reason: "Safe read-only command in accept-edits mode" };
      }
      return {
        decision: "prompt",
        reason: "Accept-edits mode requires approval for active shell commands",
      };
    }

    // Default "auto" mode: check rule patterns
    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        return {
          decision: rule.decision,
          reason: rule.description,
        };
      }
    }

    // In auto mode, default to allow for standard commands
    return {
      decision: "allow",
      reason: "Auto mode allows execution",
    };
  }
}
