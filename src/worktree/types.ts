/**
 * Git Worktree Subsystem Types & Schemas.
 * Directly mirrors codex-rs/worktree & git-utils.
 */

export interface WorktreeInfo {
  path: string;
  branch: string;
  commitHash: string;
  isMain: boolean;
  isLocked?: boolean;
  threadId?: string;
}

export interface CreateWorktreeOptions {
  branch?: string;
  baseBranch?: string;
  worktreePath?: string;
  threadId?: string;
}

export interface WorktreeMergeOptions {
  commitMessage?: string;
  targetBranch?: string;
  deleteBranchAfterMerge?: boolean;
}

export interface WorktreeMergeResult {
  success: boolean;
  mergedCommit?: string;
  message: string;
}
