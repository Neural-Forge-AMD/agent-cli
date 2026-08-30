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

export interface ExecRule {
  pattern: RegExp;
  decision: ExecDecision;
  description?: string;
}

export class ExecPolicy {
  private rules: ExecRule[] = [];

  constructor() {
    this.initDefaultRules();
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

  evaluate(command: string): { decision: ExecDecision; reason?: string } {
    const trimmed = command.trim();

    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        return {
          decision: rule.decision,
          reason: rule.description,
        };
      }
    }

    // Default policy for unknown shell commands: prompt user for safety
    return {
      decision: "prompt",
      reason: "Command is not in the automatic allowlist",
    };
  }
}
