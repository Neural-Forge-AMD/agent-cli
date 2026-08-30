/**
 * shell / unified_exec tool handler.
 * Runs terminal commands using Bun.spawn with timeout and approval support.
 * 
 * Directly mirrors codex-rs/core/src/tools/handlers/shell_spec.rs.
 */

import type { Tool, ToolContext, ToolExecutionResult } from "../types";
import { ExecPolicy } from "../../security/exec-policy";

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
      },
      required: ["command"],
    },

    async execute(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<ToolExecutionResult> {
      const command = String(args.command || "").trim();
      if (!command) {
        return { output: "Error: 'command' argument cannot be empty", isError: true };
      }

      // Check execution policy
      const activePolicy = ctx.execPolicy || policy;
      const policyDecision = activePolicy.evaluate(command);

      if (policyDecision.decision === "deny") {
        return {
          output: `Error: Command execution denied by policy: ${policyDecision.reason}`,
          isError: true,
        };
      }

      if (policyDecision.decision === "prompt" && ctx.requestApproval) {
        const approved = await ctx.requestApproval(
          policyDecision.reason || "Executing external command",
          command
        );

        if (!approved) {
          return {
            output: `Command execution cancelled: User declined approval for '${command}'`,
            isError: true,
          };
        }
      }

      const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 30000;
      const isWindows = process.platform === "win32";
      const shellCmd = isWindows ? ["powershell.exe", "-NoProfile", "-Command", command] : ["/bin/sh", "-c", command];

      try {
        const proc = Bun.spawn(shellCmd, {
          cwd: ctx.cwd,
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
        if (result.code !== 0) outputParts.push(`\n[Process exited with code ${result.code}]`);

        const output = outputParts.join("\n") || "[Command completed with no output]";
        return {
          output,
          isError: result.code !== 0,
        };
      } catch (err) {
        return {
          output: `Failed to execute command: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

export const shellTool = createShellTool();
