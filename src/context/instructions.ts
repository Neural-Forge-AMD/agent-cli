/**
 * System Instructions Builder.
 * Combines base system prompts, tool usage instructions, persistent memories,
 * available skills catalog, and developer guidelines.
 */

export interface InstructionParams {
  basePrompt?: string;
  developerInstructions?: string;
  worldStatePrompt?: string;
  memoriesPrompt?: string;
  skillsPrompt?: string;
}

export function buildSystemPrompt(params: InstructionParams): string {
  const sections: string[] = [];

  // 1. Base identity
  sections.push(
    params.basePrompt ||
      "You are Groupy, an expert autonomous AI coding assistant. You think step-by-step, act surgically, and write clean, correct code."
  );

  // 2. General agentic guidelines directly adapted from OpenAI Codex
  sections.push(
    [
      "## Editing Constraints & Guidelines",
      "- Use `apply_patch` for surgical single-file edits. TargetContent must match existing file content exactly.",
      "- Use `write_file` for creating new files or when completely replacing the full content of a file.",
      "- Use `read_file` to inspect files and `grep_search` / `find_files` to discover symbols and locate files across the project.",
      "- NEVER create temporary scripts, scratch files, or chunk files (e.g. `_tmp_*.ps1`, `_tmp_*.txt`, `split_*.py`) in the workspace to manipulate, split, or read files.",
      "- NEVER execute shell or PowerShell scripts as a workaround for reading, writing, or editing text files.",
      "- Use the `shell` tool ONLY for running tests, build targets, package installations, or checking environment/git status.",
      "- When user requirements are ambiguous or require architectural decisions, use `request_user_input` or `ask_question` to present 2-4 clear options. Prefix your recommended choice with `(Recommended)` (e.g. `['(Recommended) Option A', 'Option B']`).",
      "- You may be in a dirty git worktree. NEVER revert existing changes made by the user.",
      "- NEVER use destructive commands like `git reset --hard` or `git checkout --`.",
      "- Be concise, direct, and act surgically. Write clean, correct code with minimal necessary modifications.",
    ].join("\n")
  );

  // 3. Persistent User Memories & Preferences (if any)
  if (params.memoriesPrompt) {
    sections.push(params.memoriesPrompt.trim());
  }

  // 4. Available Domain Skills (if any)
  if (params.skillsPrompt) {
    sections.push(params.skillsPrompt.trim());
  }

  // 5. Developer specific instructions
  if (params.developerInstructions) {
    sections.push(`## Developer Instructions\n${params.developerInstructions}`);
  }

  // 6. World state / environment snapshot
  if (params.worldStatePrompt) {
    sections.push(`## Environment Context\n${params.worldStatePrompt}`);
  }

  return sections.join("\n\n");
}
