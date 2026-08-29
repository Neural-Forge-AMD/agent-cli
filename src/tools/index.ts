export * from "./types";
export * from "./router";
export * from "./handlers/apply-patch";
export * from "./handlers/shell";
export * from "./handlers/file-ops";
export * from "./handlers/request-user-input";

import { ToolRouter } from "./router";
import { applyPatchTool } from "./handlers/apply-patch";
import { shellTool } from "./handlers/shell";
import { readFileTool, writeFileTool, listDirTool } from "./handlers/file-ops";
import { requestUserInputTool } from "./handlers/request-user-input";
import { createFileSearchTools } from "../search/tools";
import { createCodeModeTools } from "../code-mode/tools";
import type { SkillsLoader } from "../skills/loader";
import { createSkillTool } from "../skills/tool";
import type { MemoryStore } from "../memories/store";
import { createRememberTool } from "../memories/tool";
import type { WorktreeManager } from "../worktree/manager";
import { createWorktreeTools } from "../worktree/tools";

export interface DefaultToolsOptions {
  skillsLoader?: SkillsLoader;
  memoryStore?: MemoryStore;
  worktreeManager?: WorktreeManager;
}

/**
 * Creates a ToolRouter pre-populated with standard Codex-style tools,
 * including code_mode, grep_search, find_files, skills, persistent memory, and git worktree tools.
 */
export function createDefaultTools(options: DefaultToolsOptions = {}): ToolRouter {
  const router = new ToolRouter();
  router.register(applyPatchTool);
  router.register(shellTool);
  router.register(readFileTool);
  router.register(writeFileTool);
  router.register(listDirTool);
  router.register(requestUserInputTool);

  // File Search & Grep Tools
  for (const tool of createFileSearchTools()) {
    router.register(tool);
  }

  // Code-Mode Batch Execution Tool
  for (const tool of createCodeModeTools(router)) {
    router.register(tool);
  }

  if (options.skillsLoader) {
    router.register(createSkillTool(options.skillsLoader));
  }
  if (options.memoryStore) {
    router.register(createRememberTool(options.memoryStore));
  }
  if (options.worktreeManager) {
    for (const tool of createWorktreeTools(options.worktreeManager)) {
      router.register(tool);
    }
  }

  return router;
}
