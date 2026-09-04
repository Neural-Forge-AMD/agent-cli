/**
 * Execution Policy Engine for Groupy.
 * Directly mirrors codex-rs/core/src/exec_policy.rs.
 * 
 * Rules determine whether a command:
 * - is auto-approved (read-only / safe commands)
 * - requires interactive user confirmation
 * - is strictly denied
 */

import { parseShellCommand } from "./shell-parser";

export type ExecDecision = "allow" | "prompt" | "deny";
export type PermissionMode = "auto" | "manual" | "accept-edits" | "plan";

export interface ExecRule {
  pattern: RegExp;
  decision: ExecDecision;
  description?: string;
}

export class ExecPolicy {
  private denyRules: ExecRule[] = [];
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
   * Initializes standard safe, prompted, and denied command rules.
   */
  private initDefaultRules(): void {
    // 1. Strictly Denied Commands (System Destruction & Raw Disk Writing) - Absolute Invariant
    this.addDenyRule(/(?:^|[/\\])(mkfs|format|fdisk|parted)\b/i, "Destructive filesystem formatting operation");
    this.addDenyRule(/^dd\s+.*(of=\/dev\/|\/dev\/sd|\/dev\/nvme)/i, "Raw block device write attempt");
    this.addDenyRule(/(?:^|[/\\])(reboot|shutdown|poweroff|init\s+0)\b/i, "System power manipulation");

    // 2. Potentially Dangerous / Destructive -> Prompt User
    this.addRule(/^(sudo|su|doas|runas)\b/i, "prompt", "Privilege escalation attempt");
    this.addRule(/^(rm|del|rmdir|shred|unlink)\b/i, "prompt", "Destructive file removal");
    this.addRule(/^(chmod|chown|kill|pkill|killall|systemctl|service|crontab)\b/i, "prompt", "System administration & process control");
    this.addRule(/^(git\s+(push|reset\s+--hard|clean\s+-fd|rebase|branch\s+-D|checkout\s+-f))\b/i, "prompt", "Destructive git operation");
    this.addRule(/^(curl|wget|fetch|ssh|scp|sftp|ftp|rsync|nc|ncat|netcat|socat|telnet)\b/i, "prompt", "Network & remote transfer");
    this.addRule(/^(bash|sh|zsh|dash|ksh|cmd(\.exe)?|powershell(\.exe)?|pwsh)\s+(-c|-command|\/c)\b/i, "prompt", "Arbitrary subshell command execution");
    this.addRule(/^(python|python3|node|bun|perl|ruby)\s+(-c|-e)\b/i, "prompt", "Inline arbitrary code evaluation");
    this.addRule(/^(eval|exec)\b/i, "prompt", "Dynamic code execution");
    this.addRule(/^(npm\s+publish|bun\s+publish|cargo\s+publish)\b/i, "prompt", "Package registry publication");

    // 3. Known Safe Inspection & Dev Commands -> Allow
    this.addRule(/^(git\s+(status|log|diff|branch|show|rev-parse|tag|remote|describe))\b/i, "allow", "Safe git query");
    this.addRule(/^(ls|dir|cat|type|grep|rg|find|pwd|echo|head|tail|wc|which|where|stat|file|du|df)\b/i, "allow", "Safe read-only shell command");
    this.addRule(/^(bun\s+(test|run|--version|-v)|npm\s+(test|run|--version|-v)|npx\s+(tsc|eslint|oxlint)|tsc|cargo\s+(check|test|build)|go\s+(test|vet|build)|pytest|python\s+-m\s+unittest|node\s+(-v|--version|--test))\b/i, "allow", "Testing, typechecking & build verification");
  }

  addDenyRule(pattern: RegExp, description?: string): void {
    this.denyRules.push({ pattern, decision: "deny", description });
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
        prompt: true,
        isPlanBlocked: true,
        reason: `[Plan Mode Gate] Approval required to mutate '${filePath || "file"}' and proceed with implementation.`,
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
   * Parses command chains (;, &&, ||, |, &, \n) and subshells ($(), ``) to prevent command injection bypasses.
   */
  evaluate(command: string): { decision: ExecDecision; reason?: string } {
    const trimmed = command.trim();
    if (!trimmed) {
      return { decision: "allow" };
    }

    // Decompose compound commands, pipelines, and subshells
    const parsed = parseShellCommand(trimmed);
    const subCommands = [...parsed.commands, ...parsed.subshellCommands].map((c) => c.trim()).filter(Boolean);

    // If compound command, pipeline, or command substitution is detected
    if (subCommands.length > 1 || parsed.subshellCommands.length > 0) {
      for (const subCmd of subCommands) {
        const subResult = this.evaluateSingle(subCmd);
        if (subResult.decision === "deny") {
          return {
            decision: "deny",
            reason: `Chained command contains denied operation: '${subCmd}' (${subResult.reason || "Forbidden"})`,
          };
        }
        if (subResult.decision === "prompt") {
          return {
            decision: "prompt",
            reason: `Chained command contains operation requiring confirmation: '${subCmd}' (${subResult.reason || "Requires approval"})`,
          };
        }
      }

      // If pipeline pipes into a shell interpreter (e.g. `curl ... | sh` or `cat ... | bash`)
      if (parsed.hasPipes && /\|\s*(ba|z|k|c)?sh\b/i.test(trimmed)) {
        return {
          decision: "prompt",
          reason: "Pipeline executes piped input directly into shell interpreter (| sh)",
        };
      }

      return { decision: "allow", reason: "All chained sub-commands are permitted" };
    }

    // Single command
    return this.evaluateSingle(trimmed);
  }

  private evaluateSingle(command: string): { decision: ExecDecision; reason?: string } {
    const trimmed = command.trim();

    // 0. Absolute Deny Rules ALWAYS take precedence across all permission modes and session rules
    for (const rule of this.denyRules) {
      if (rule.pattern.test(trimmed)) {
        return {
          decision: "deny",
          reason: rule.description,
        };
      }
    }

    if (this.mode === "plan") {
      // In plan mode, allow read-only inspection; require prompt gate for mutating commands
      const isReadOnly = /^(git\s+(status|log|diff|branch|show|rev-parse|tag|remote)|ls|dir|cat|type|grep|rg|find|pwd|which|where)\b/i.test(trimmed);
      if (isReadOnly) {
        return { decision: "allow", reason: "Read-only inspection allowed in Plan mode" };
      }
      return {
        decision: "prompt",
        reason: `[Plan Mode Gate] Approval required to execute shell command '${trimmed}' in Plan Mode`,
      };
    }

    if (this.mode === "manual") {
      return {
        decision: "prompt",
        reason: "Manual mode requires confirmation for all shell commands",
      };
    }

    if (this.mode === "accept-edits") {
      // "accept-edits" auto-approves file edits, but prompts for shell commands (unless safe read-only)
      const isReadOnly = /^(git\s+(status|log|diff|branch|show|rev-parse)|ls|dir|cat|type|grep|rg|find|pwd|bun\s+test|npm\s+test)\b/i.test(trimmed);
      if (isReadOnly) {
        return { decision: "allow", reason: "Safe read-only command in accept-edits mode" };
      }
      return {
        decision: "prompt",
        reason: "Accept-edits mode requires approval for active shell commands",
      };
    }

    // Default "auto" mode:
    // 1. Check all explicit rules
    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        return {
          decision: rule.decision,
          reason: rule.description,
        };
      }
    }

    // 2. Check safe workspace dev commands
    if (this.isRecognizedSafeDevCommand(trimmed)) {
      return {
        decision: "allow",
        reason: "Safe development workspace command",
      };
    }

    // 3. Fail-closed: unclassified or unknown commands require user confirmation in auto mode
    const firstWord = trimmed.split(/\s+/)[0] || trimmed;
    return {
      decision: "prompt",
      reason: `Command '${firstWord}' is unclassified and requires confirmation in auto mode`,
    };
  }

  private isRecognizedSafeDevCommand(command: string): boolean {
    // Recognized safe workspace management and build tooling
    return /^(git\s+(checkout|add|commit|stash|merge|pull|init)|bun\s+(install|add|remove)|npm\s+(install|i|add|remove)|yarn\s+(add|remove)|pnpm\s+(add|remove|install)|mkdir|touch|cp|copy|mv|move|clear|cls|echo|printf|node|bun|python|python3|cargo|go)\b/i.test(command);
  }
}
