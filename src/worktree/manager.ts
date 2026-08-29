/**
 * WorktreeManager - Lifecycle orchestration for isolated Git Worktrees.
 * Directly mirrors codex-rs/worktree/src/lib.rs, settings.rs, & metadata.rs.
 */

import { resolve, join, basename } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import {
  isGitRepo,
  getRepoRoot,
  getMainRepoRoot,
  getCurrentBranch,
  listWorktreesGit,
  createWorktreeGit,
  removeWorktreeGit,
  runGit,
} from "./git";
import type {
  WorktreeInfo,
  CreateWorktreeOptions,
  WorktreeMergeOptions,
  WorktreeMergeResult,
} from "./types";

export const DEFAULT_WORKTREE_KEEP_COUNT = 15;

export interface WorktreeManagerOptions {
  baseStorageDir?: string;
  autoCleanupEnabled?: boolean;
  keepCount?: number;
}

export class WorktreeManager {
  private baseStorageDir?: string;
  private autoCleanupEnabled: boolean;
  private keepCount: number;

  constructor(options: WorktreeManagerOptions = {}) {
    this.baseStorageDir = options.baseStorageDir;
    this.autoCleanupEnabled = options.autoCleanupEnabled ?? true;
    this.keepCount = options.keepCount || DEFAULT_WORKTREE_KEEP_COUNT;
  }

  /**
   * Creates an isolated Git Worktree on a new branch for task execution
   */
  async createWorktree(
    cwd: string,
    options: CreateWorktreeOptions = {}
  ): Promise<WorktreeInfo> {
    const repoRoot = await getMainRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error(`Directory '${cwd}' is not inside a valid Git repository.`);
    }

    // Auto-cleanup oldest worktrees if threshold exceeded
    if (this.autoCleanupEnabled) {
      await this.pruneExcessWorktrees(repoRoot);
    }

    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const branchName = options.branch || `groupy/${taskId}`;

    // Target worktree directory
    const targetDir =
      options.worktreePath ||
      (this.baseStorageDir
        ? resolve(this.baseStorageDir, branchName.replace(/\//g, "_"))
        : resolve(repoRoot, ".groupy", "worktrees", branchName.replace(/\//g, "_")));

    const worktreeParent = resolve(targetDir, "..");
    if (!existsSync(worktreeParent)) {
      mkdirSync(worktreeParent, { recursive: true });
    }

    const baseBranch = options.baseBranch || (await getCurrentBranch(repoRoot));

    const result = await createWorktreeGit(repoRoot, targetDir, branchName, baseBranch);
    if (!result.success) {
      throw new Error(`Failed to create git worktree: ${result.error}`);
    }

    // Write thread/metadata binding file matching codex-rs/worktree/metadata.rs
    const metaPath = join(targetDir, "groupy-thread.json");
    try {
      writeFileSync(
        metaPath,
        JSON.stringify(
          {
            version: 1,
            ownerThreadId: options.threadId || null,
            branch: branchName,
            baseBranch,
            createdAt: Date.now(),
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {}

    const worktrees = await listWorktreesGit(repoRoot);
    const created = worktrees.find((w) => resolve(w.path) === resolve(targetDir));

    return (
      created || {
        path: targetDir,
        branch: branchName,
        commitHash: "HEAD",
        isMain: false,
        threadId: options.threadId,
      }
    );
  }

  /**
   * Lists all active worktrees for the current repository
   */
  async listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
    const repoRoot = await getMainRepoRoot(cwd);
    if (!repoRoot) return [];

    const worktrees = await listWorktreesGit(repoRoot);

    // Enrich with metadata if present
    return worktrees.map((wt) => {
      const metaPath = join(wt.path, "groupy-thread.json");
      if (existsSync(metaPath)) {
        try {
          const raw = JSON.parse(readFileSync(metaPath, "utf8"));
          return { ...wt, threadId: raw.ownerThreadId || raw.threadId };
        } catch {}
      }
      return wt;
    });
  }

  /**
   * Commits changes in the worktree and merges back into the target branch
   */
  async mergeWorktree(
    worktreePath: string,
    options: WorktreeMergeOptions = {}
  ): Promise<WorktreeMergeResult> {
    const resolvedPath = resolve(worktreePath);
    const repoRoot = await getMainRepoRoot(resolvedPath);
    if (!repoRoot) {
      return { success: false, message: "Worktree path is not a valid git repository." };
    }

    const currentWorktreeBranch = await getCurrentBranch(resolvedPath);
    if (!currentWorktreeBranch || currentWorktreeBranch === "HEAD") {
      return { success: false, message: "Worktree is detached or has no valid branch." };
    }

    // 1. Stage and commit uncommitted changes in worktree
    const commitMsg = options.commitMessage || `Groupy task changes from ${currentWorktreeBranch}`;
    await runGit(resolvedPath, ["add", "-A"]);
    await runGit(resolvedPath, ["commit", "-m", commitMsg]);

    const targetBranch = options.targetBranch || (await getCurrentBranch(repoRoot));

    // 2. Perform merge in repo root
    const mergeRes = await runGit(repoRoot, [
      "merge",
      currentWorktreeBranch,
      "--no-ff",
      "-m",
      `Merge ${currentWorktreeBranch} into ${targetBranch}`,
    ]);

    if (mergeRes.exitCode !== 0) {
      return {
        success: false,
        message: `Merge conflict or failure merging '${currentWorktreeBranch}' into '${targetBranch}': ${mergeRes.stderr || mergeRes.stdout}`,
      };
    }

    const latestCommit = await runGit(repoRoot, ["rev-parse", "HEAD"]);

    // 3. Optional cleanup
    if (options.deleteBranchAfterMerge) {
      await this.removeWorktree(resolvedPath, true);
    }

    return {
      success: true,
      mergedCommit: latestCommit.stdout,
      message: `Successfully merged '${currentWorktreeBranch}' into '${targetBranch}'.`,
    };
  }

  /**
   * Removes an isolated worktree and cleans up
   */
  async removeWorktree(worktreePath: string, deleteBranch = false): Promise<boolean> {
    const resolvedPath = resolve(worktreePath);
    const repoRoot = await getMainRepoRoot(resolvedPath);
    if (!repoRoot) return false;

    let branchName = "";
    if (deleteBranch) {
      branchName = await getCurrentBranch(resolvedPath);
    }

    const res = await removeWorktreeGit(repoRoot, resolvedPath, deleteBranch);
    if (!res.success) return false;

    if (deleteBranch && branchName && branchName !== "main" && branchName !== "master") {
      await runGit(repoRoot, ["branch", "-D", branchName]);
    }

    return true;
  }

  /**
   * Prunes excess worktrees beyond retention keep count
   */
  private async pruneExcessWorktrees(repoRoot: string): Promise<void> {
    try {
      const all = await listWorktreesGit(repoRoot);
      const secondaryWorktrees = all.filter((w) => !w.isMain && !w.isLocked);

      if (secondaryWorktrees.length >= this.keepCount) {
        const excessCount = secondaryWorktrees.length - this.keepCount + 1;
        const toPrune = secondaryWorktrees.slice(0, excessCount);

        for (const wt of toPrune) {
          await this.removeWorktree(wt.path, false);
        }
      }
    } catch {}
  }
}
