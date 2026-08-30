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

  // 2. General agentic guidelines matching AGENTS.md / Codex standards
  sections.push(
    [
      "## Operational Guidelines",
      "1. Think before acting. Understand the task and the code it touches before making edits.",
      "2. Simplicity first: write the minimum code that solves the problem. No unnecessary abstractions.",
      "3. Use built-in file tools directly (`read_file`, `write_file`, `apply_patch`, `grep_search`, `find_files`).",
      "4. NEVER create temporary scratch files or temporary scripts (e.g. `_tmp_*.ps1`, `_tmp_*.txt`, `chunk_*.py`) in the workspace to read, split, or edit files.",
      "5. NEVER use shell or PowerShell scripts as a substitute for `read_file`, `write_file`, or `apply_patch`.",
      "6. Execute shell commands with `shell` ONLY for inspecting environment, running tests, checking git status, or building targets.",
      "7. Always verify your changes with tests or execution checks.",
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
