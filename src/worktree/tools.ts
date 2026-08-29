/**
 * Tool handlers for Git Worktree isolation.
 * Allows the LLM to create isolated worktrees for risky refactors and merge them upon approval.
 */

import type { Tool } from "../tools/types";
import type { WorktreeManager } from "./manager";

export function createWorktreeTools(manager: WorktreeManager): Tool[] {
  const createTool: Tool = {
    name: "create_worktree",
    description:
      "Create an isolated Git Worktree on a new branch for risk-free code refactoring or sub-agent parallel execution without modifying the main branch.",
    parameters: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Optional custom branch name (e.g. 'refactor/auth-pipeline').",
        },
      },
    },
    async execute(args, context) {
      try {
        const wt = await manager.createWorktree(context.cwd, {
          branch: args.branch as string | undefined,
        });
        return {
          output: `Isolated Git Worktree created:\n- Path: ${wt.path}\n- Branch: ${wt.branch}\n- Commit: ${wt.commitHash}\nUse this path as the working directory for isolated modifications.`,
        };
      } catch (err) {
        return {
          output: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };

  const listTool: Tool = {
    name: "list_worktrees",
    description: "List all active Git Worktrees and their branches in the current repository.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_args, context) {
      const list = await manager.listWorktrees(context.cwd);
      if (list.length === 0) {
        return { output: "No active Git Worktrees found." };
      }
      const lines = list.map(
        (w) =>
          `- ${w.path} [${w.branch}] (${w.isMain ? "MAIN" : "WORKTREE"})${w.isLocked ? " [LOCKED]" : ""}`
      );
      return { output: `Active Git Worktrees (${list.length}):\n${lines.join("\n")}` };
    },
  };

  const mergeTool: Tool = {
    name: "merge_worktree",
    description: "Merge changes from an isolated Git Worktree back into the target branch.",
    parameters: {
      type: "object",
      properties: {
        worktree_path: {
          type: "string",
          description: "Absolute path to the worktree to merge.",
        },
        commit_message: {
          type: "string",
          description: "Commit message for the merged changes.",
        },
        delete_after_merge: {
          type: "boolean",
          description: "Whether to remove the worktree and branch after successful merge. Defaults to true.",
        },
      },
      required: ["worktree_path"],
    },
    async execute(args) {
      const result = await manager.mergeWorktree(String(args.worktree_path), {
        commitMessage: args.commit_message as string | undefined,
        deleteBranchAfterMerge: args.delete_after_merge !== false,
      });

      return {
        output: result.message,
        isError: !result.success,
      };
    },
  };

  const removeTool: Tool = {
    name: "remove_worktree",
    description: "Remove and clean up an isolated Git Worktree.",
    parameters: {
      type: "object",
      properties: {
        worktree_path: {
          type: "string",
          description: "Absolute path to the worktree to remove.",
        },
        delete_branch: {
          type: "boolean",
          description: "Whether to delete the temporary branch as well. Defaults to true.",
        },
      },
      required: ["worktree_path"],
    },
    async execute(args) {
      const success = await manager.removeWorktree(
        String(args.worktree_path),
        args.delete_branch !== false
      );
      return {
        output: success
          ? `Worktree '${args.worktree_path}' removed successfully.`
          : `Failed to remove worktree '${args.worktree_path}'.`,
        isError: !success,
      };
    },
  };

  return [createTool, listTool, mergeTool, removeTool];
}
