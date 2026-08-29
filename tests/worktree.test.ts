import { describe, expect, test, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import {
  WorktreeManager,
  createWorktreeTools,
  ToolRouter,
  runGit,
} from "../src";

function getUniqueTestRepoDir(): string {
  return resolve(
    import.meta.dir,
    "fixtures",
    `tmp_git_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
}

async function initTestGitRepo(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.name", "GroupyTester"]);
  await runGit(dir, ["config", "user.email", "tester@groupy.dev"]);

  writeFileSync(join(dir, "README.md"), "# Initial Main Branch Content\n", "utf8");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "Initial commit"]);
}

async function cleanupTestGitRepo(dir: string): Promise<void> {
  try {
    await runGit(dir, ["worktree", "prune"]);
  } catch {}

  // Safe retry cleanup for Windows file locks
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

describe("Git Worktree Task Isolation Subsystem", () => {
  test("creates an isolated Git Worktree on a new branch", async () => {
    const testRepoDir = getUniqueTestRepoDir();
    await initTestGitRepo(testRepoDir);

    try {
      const manager = new WorktreeManager();

      const wt = await manager.createWorktree(testRepoDir, {
        branch: "groupy/feature-auth",
      });

      expect(wt.branch).toBe("groupy/feature-auth");
      expect(existsSync(wt.path)).toBe(true);
      expect(existsSync(join(wt.path, "README.md"))).toBe(true);

      // Verify worktree listing
      const list = await manager.listWorktrees(testRepoDir);
      expect(list.length).toBeGreaterThanOrEqual(2); // Main + Worktree

      const isolated = list.find((w) => w.branch === "groupy/feature-auth");
      expect(isolated).toBeDefined();
      expect(isolated?.isMain).toBe(false);

      // Clean up worktree
      await manager.removeWorktree(wt.path, true);
    } finally {
      await cleanupTestGitRepo(testRepoDir);
    }
  });

  test("modifications in worktree do not pollute main working directory", async () => {
    const testRepoDir = getUniqueTestRepoDir();
    await initTestGitRepo(testRepoDir);

    try {
      const manager = new WorktreeManager();

      const wt = await manager.createWorktree(testRepoDir, {
        branch: "groupy/task-isolation-test",
      });

      // Write a new file only in the isolated worktree
      writeFileSync(join(wt.path, "isolated_file.txt"), "Secret feature draft", "utf8");

      // Check main branch working tree
      expect(existsSync(join(testRepoDir, "isolated_file.txt"))).toBe(false);
      expect(existsSync(join(wt.path, "isolated_file.txt"))).toBe(true);

      // Clean up
      await manager.removeWorktree(wt.path, true);
    } finally {
      await cleanupTestGitRepo(testRepoDir);
    }
  });

  test("merges worktree changes back into main branch cleanly", async () => {
    const testRepoDir = getUniqueTestRepoDir();
    await initTestGitRepo(testRepoDir);

    try {
      const manager = new WorktreeManager();

      const wt = await manager.createWorktree(testRepoDir, {
        branch: "groupy/task-merge-test",
      });

      writeFileSync(join(wt.path, "merged_feature.txt"), "Feature ready for production", "utf8");

      const mergeResult = await manager.mergeWorktree(wt.path, {
        commitMessage: "Implement merged feature",
        deleteBranchAfterMerge: true,
      });

      expect(mergeResult.success).toBe(true);
      expect(mergeResult.message).toContain("Successfully merged");

      // Verify main working tree now has the merged file
      expect(existsSync(join(testRepoDir, "merged_feature.txt"))).toBe(true);
      expect(readFileSync(join(testRepoDir, "merged_feature.txt"), "utf8")).toBe(
        "Feature ready for production"
      );
    } finally {
      await cleanupTestGitRepo(testRepoDir);
    }
  });

  test("LLM tools (create_worktree, list_worktrees, merge_worktree) execute via ToolRouter", async () => {
    const testRepoDir = getUniqueTestRepoDir();
    await initTestGitRepo(testRepoDir);

    try {
      const manager = new WorktreeManager();
      const router = new ToolRouter();
      for (const tool of createWorktreeTools(manager)) {
        router.register(tool);
      }

      expect(router.has("create_worktree")).toBe(true);
      expect(router.has("list_worktrees")).toBe(true);
      expect(router.has("merge_worktree")).toBe(true);

      // 1. Create worktree via tool
      const createRes = await router.execute(
        "create_worktree",
        { branch: "groupy/tool-test-branch" },
        { cwd: testRepoDir, turnId: "turn_wt_1" }
      );
      expect(createRes.isError).toBeFalsy();
      expect(createRes.output).toContain("Isolated Git Worktree created");

      // 2. List worktrees via tool
      const listRes = await router.execute(
        "list_worktrees",
        {},
        { cwd: testRepoDir, turnId: "turn_wt_2" }
      );
      expect(listRes.isError).toBeFalsy();
      expect(listRes.output).toContain("groupy/tool-test-branch");

      // 3. Clean up
      const list = await manager.listWorktrees(testRepoDir);
      const created = list.find((w) => w.branch === "groupy/tool-test-branch");
      if (created) {
        await manager.removeWorktree(created.path, true);
      }
    } finally {
      await cleanupTestGitRepo(testRepoDir);
    }
  });
});
