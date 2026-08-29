/**
 * Low-level Git Worktree & Repository Execution Utilities.
 * Directly mirrors codex-rs/worktree/src/git.rs & codex-rs/git-utils.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { WorktreeInfo } from "./types";

const NON_INHERITABLE_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_GRAFT_FILE",
];

function scrubGitEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of NON_INHERITABLE_GIT_ENV) {
    delete env[key];
  }
  return env;
}

/**
 * Runs a git command in the specified working directory
 */
export async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: scrubGitEnv(),
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return res.exitCode === 0 && res.stdout === "true";
}

export async function getRepoRoot(cwd: string): Promise<string | null> {
  const res = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (res.exitCode !== 0 || !res.stdout) return null;
  return resolve(res.stdout);
}

export async function getMainRepoRoot(cwd: string): Promise<string | null> {
  const res = await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (res.exitCode === 0 && res.stdout) {
    const commonDir = resolve(cwd, res.stdout);
    return resolve(commonDir, "..");
  }
  return getRepoRoot(cwd);
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const res = await runGit(cwd, ["branch", "--show-current"]);
  if (res.exitCode === 0 && res.stdout) {
    return res.stdout;
  }
  const fallback = await runGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return fallback.stdout || "HEAD";
}

/**
 * Parses git worktree list output in porcelain format
 */
export async function listWorktreesGit(repoRoot: string): Promise<WorktreeInfo[]> {
  const res = await runGit(repoRoot, ["worktree", "list", "--porcelain"]);
  if (res.exitCode !== 0) return [];

  const worktrees: WorktreeInfo[] = [];
  const blocks = res.stdout.split("\n\n").filter(Boolean);

  let isFirst = true;
  for (const block of blocks) {
    const lines = block.split("\n");
    let path = "";
    let commitHash = "";
    let branch = "";
    let isLocked = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = resolve(line.slice(9).trim());
      } else if (line.startsWith("HEAD ")) {
        commitHash = line.slice(5).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice(7).trim();
        branch = ref.replace(/^refs\/heads\//, "");
      } else if (line.startsWith("locked")) {
        isLocked = true;
      }
    }

    if (path) {
      worktrees.push({
        path,
        branch: branch || "detached",
        commitHash,
        isMain: isFirst,
        isLocked,
      });
      isFirst = false;
    }
  }

  return worktrees;
}

export async function createWorktreeGit(
  repoRoot: string,
  targetDir: string,
  branchName: string,
  baseBranch?: string
): Promise<{ success: boolean; error?: string }> {
  const args = ["worktree", "add", "-b", branchName, targetDir];
  if (baseBranch) {
    args.push(baseBranch);
  }

  const res = await runGit(repoRoot, args);
  if (res.exitCode !== 0) {
    return { success: false, error: res.stderr || res.stdout };
  }
  return { success: true };
}

export async function removeWorktreeGit(
  repoRoot: string,
  worktreePath: string,
  deleteBranch = false
): Promise<{ success: boolean; error?: string }> {
  const res = await runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  if (res.exitCode !== 0) {
    return { success: false, error: res.stderr || res.stdout };
  }

  // Prune dead worktrees
  await runGit(repoRoot, ["worktree", "prune"]);

  return { success: true };
}
