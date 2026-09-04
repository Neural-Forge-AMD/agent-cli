/**
 * shell / unified_exec tool handler.
 * Runs terminal commands using Bun.spawn with timeout, approval escalation, prefix_rule persistence, and kernel sandboxing.
 * 
 * Directly mirrors codex-rs/core/src/tools/handlers/shell_spec.rs and approvals.rs.
 */

import type { Tool, ToolContext, ToolExecutionResult } from "../types";
import { ExecPolicy } from "../../security/exec-policy";
import { parseShellCommand } from "../../security/shell-parser";
import { globalKernelSandbox } from "../../security/kernel/manager";
import { globalPrefixRulesStore } from "../../storage/prefix-rules-store";
import { globalEphemeralWorkspace } from "../../workspace/ephemeral";

export interface ShellToolArgs {
  command: string;
  timeoutMs?: number;
  sandbox_permissions?: "require_escalated";
  prefix_rule?: string[];
  justification?: string;
}

export function createShellTool(policy: ExecPolicy = new ExecPolicy()): Tool {
  return {
    name: "shell",
    description:
      "Execute a shell command in the local workspace environment. Returns stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command line string to execute.",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum execution time in milliseconds (default: 30000ms).",
        },
        sandbox_permissions: {
          type: "string",
          enum: ["require_escalated"],
          description: "Request approval to execute command outside the sandbox or with unrestricted network.",
        },
        prefix_rule: {
          type: "array",
          items: { type: "string", description: "Command prefix token" },
          description: "Optional command prefix rule to allow matching commands in future sessions.",
        },
        justification: {
          type: "string",
          description: "Explanation of why escalated privileges or network access is required.",
        },
      },
      required: ["command"],
    },

    async execute(
      rawArgs: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<ToolExecutionResult> {
      const command = String(rawArgs.command || "").trim();
      if (!command) {
        return { output: "Error: 'command' argument cannot be empty", isError: true };
      }

      const args = rawArgs as unknown as ShellToolArgs;
      const rulesStore = ctx.prefixRulesStore || globalPrefixRulesStore;
      const activePolicy = ctx.execPolicy || policy;

      // 1. Invariant: Strictly denied commands can NEVER execute, even if escalated
      const policyDecision = activePolicy.evaluate(command);
      if (policyDecision.decision === "deny") {
        return {
          output: `Error: Command execution denied by policy: ${policyDecision.reason}`,
          isError: true,
        };
      }

      // 2. Check if command matches approved prefix rule
      const parsed = parseShellCommand(command);
      const isCompound = parsed.commands.length > 1 || parsed.subshellCommands.length > 0 || parsed.hasPipes;
      let isEscalated = false;

      if (!isCompound) {
        const cmdTokens = command.split(/\s+/).filter(Boolean);
        if (rulesStore.isApproved(ctx.cwd, cmdTokens)) {
          isEscalated = true;
        }
      } else {
        // Compound commands can only be auto-escalated if EVERY chained sub-command is approved
        const allSubCommands = [...parsed.commands, ...parsed.subshellCommands];
        if (
          allSubCommands.length > 0 &&
          allSubCommands.every((sub) => rulesStore.isApproved(ctx.cwd, sub.split(/\s+/).filter(Boolean)))
        ) {
          isEscalated = true;
        }
      }

      // 3. Handle explicit escalation request
      if (!isEscalated && args.sandbox_permissions === "require_escalated") {
        if (ctx.requestApproval) {
          const promptDesc = args.justification || "Executing command with escalated permissions";
          const approvalResult = await ctx.requestApproval(
            promptDesc,
            command,
            args.prefix_rule
          );

          const isAllowed = typeof approvalResult === "boolean" ? approvalResult : approvalResult?.allowed;
          const remember = typeof approvalResult === "object" ? approvalResult?.rememberPrefix : false;

          if (!isAllowed) {
            return {
              output: `Command execution cancelled: User declined approval for '${command}'`,
              isError: true,
            };
          }

          if (remember && args.prefix_rule && Array.isArray(args.prefix_rule)) {
            rulesStore.addRule(ctx.cwd, args.prefix_rule);
          }

          isEscalated = true;
        }
      }

      // 4. If policy requires prompt and not already escalated, request user confirmation
      if (policyDecision.decision === "prompt" && !isEscalated) {
        if (ctx.requestApproval) {
          const approvalResult = await ctx.requestApproval(
            policyDecision.reason || "Executing external command",
            command
          );

          const isAllowed = typeof approvalResult === "boolean" ? approvalResult : approvalResult?.allowed;
          if (!isAllowed) {
            return {
              output: `Command execution cancelled: User declined approval for '${command}'`,
              isError: true,
            };
          }
        } else {
          return {
            output: `Error: Command execution requires user confirmation: '${command}' (${policyDecision.reason || "Requires approval"})`,
            isError: true,
          };
        }
      }

      const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 30000;
      const isWindows = process.platform === "win32";
      const baseCmd = isWindows
        ? ["cmd.exe", "/d", "/s", "/c", command]
        : ["/bin/sh", "-c", command];

      // 4. Provision per-command ephemeral scratchpad for zero workspace pollution
      const ephemeralScratchpad = globalEphemeralWorkspace.createScratchpad(ctx.turnId);

      // Build sandbox profile & wrap command (relax network only if explicitly escalated)
      const sandboxProfile = globalKernelSandbox.buildDefaultProfile(ctx.cwd, isEscalated);
      let sandboxNotice: string | null = null;
      const wrappedCmd = globalKernelSandbox.wrapCommand(baseCmd, sandboxProfile, (w) => {
        sandboxNotice = w;
      });

      try {
        const proc = Bun.spawn(wrappedCmd, {
          cwd: ctx.cwd,
          env: {
            ...process.env,
            TMPDIR: ephemeralScratchpad,
            TEMP: ephemeralScratchpad,
            TMP: ephemeralScratchpad,
            GROUPY_SCRATCH_DIR: ephemeralScratchpad,
            ...(ctx as any).proxyEnv,
          },
          stdout: "pipe",
          stderr: "pipe",
        });

        // Handle abort signal
        if (ctx.signal) {
          ctx.signal.addEventListener("abort", () => {
            try {
              proc.kill();
            } catch {}
          });
        }

        // Timeout promise
        const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) =>
          setTimeout(() => resolve({ isTimeout: true }), timeoutMs)
        );

        const result = await Promise.race([
          proc.exited.then(async (code) => {
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();
            return { isTimeout: false, code, stdout, stderr };
          }),
          timeoutPromise,
        ]);

        if (result.isTimeout) {
          try {
            proc.kill();
          } catch {}
          return {
            output: `Error: Command timed out after ${timeoutMs}ms: '${command}'`,
            isError: true,
          };
        }

        const outputParts: string[] = [];
        if (result.stdout) outputParts.push(result.stdout.trim());
        if (result.stderr) outputParts.push(`STDERR:\n${result.stderr.trim()}`);
        if (result.code !== 0) {
          outputParts.push(`\n[Process exited with non-zero code ${result.code}]`);
          outputParts.push(`[Systematic Error Recovery Checklist]:
1. Inspect STDERR above to pinpoint syntax errors, failed test assertions, or missing dependencies.
2. If this is a test failure, trace the failure in source code and fix the root cause before re-running.
3. If this is a missing command/module, install or configure the prerequisite.`);
        }

        let rawOutput = outputParts.join("\n") || "[Command completed with no output]";

        // Context Protection: Truncate gigantic shell outputs (both line-based and character-based)
        const lines = rawOutput.split("\n");
        const MAX_LINES = 250;
        const MAX_CHARS = 30000;

        if (lines.length > MAX_LINES) {
          const headLines = lines.slice(0, 125).join("\n");
          const tailLines = lines.slice(-100).join("\n");
          rawOutput = `${headLines}\n\n... [${lines.length - 225} lines truncated for context efficiency] ...\n\n${tailLines}`;
        }

        if (rawOutput.length > MAX_CHARS) {
          const headChars = rawOutput.slice(0, 16000);
          const tailChars = rawOutput.slice(-12000);
          rawOutput = `${headChars}\n\n... [${rawOutput.length - 28000} characters truncated for context efficiency] ...\n\n${tailChars}`;
        }

        if (sandboxNotice) {
          rawOutput = `[Sandbox Notice]: ${sandboxNotice}\n${rawOutput}`;
        }

        return {
          output: rawOutput,
          isError: result.code !== 0,
        };
      } catch (err) {
        return {
          output: `Execution error: ${err instanceof Error ? err.message : String(err)}
[Systematic Error Recovery Checklist]:
1. Verify command syntax, arguments, and executable availability in PATH.
2. Check if the current working directory ('${ctx.cwd}') is valid.`,
          isError: true,
        };
      } finally {
        // Auto-clean per-command ephemeral scratchpad
        globalEphemeralWorkspace.cleanup(ephemeralScratchpad);
      }
    },
  };
}

export const shellTool = createShellTool();
