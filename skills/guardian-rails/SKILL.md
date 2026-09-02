---
name: guardian-rails
description: "Global safety and workspace cleanliness guardrails: strict zero-pollution rules against temporary/scratch files, mandatory in-place editing, and pre-action safety protocols."
risk: low
source: built-in
---

# Global Guardian Rails (Zero-Pollution & Safe Execution Protocol)

All AI agents, sub-agents, and domain skills must adhere to these non-negotiable guardrails before and during any code generation or tool execution.

---

## 1. Zero Scratch / Temporary File Pollution

```
NEVER DUMP TEMPORARY, SCRATCH, OR DRAFT FILES INTO THE WORKSPACE ROOT OR RANDOM FOLDERS.
```

* ❌ **Forbidden Patterns**:
  * `temp_*`, `tmp_*`, `scratch_*`, `draft_*`, `sandbox_*`
  * `test_preview.html`, `design_draft.tsx`, `preview.html`, `mock_*.json`
  * One-off scripts dumped into root directory (`test.js`, `run.py`, `script.sh`)
* ✅ **Mandatory Practice**:
  * Implement code **in-place** directly within the project's real directory architecture (e.g., `src/components/`, `src/pages/`, `lib/`, `tests/`).
  * If a file path is ambiguous, inspect existing project structure (`list_dir`, `find_files`) to locate the correct directory before writing.

---

## 2. Frontend & Design Zero-Spam Mandate

When asked to create UI, prototypes, designs, or styles:
1. **Target Real Files**: Edit or create production-grade components directly inside the existing frontend framework structure (e.g. `src/components/`, `app/`, `views/`).
2. **Never Create Detached Preview Files**: Do not generate detached single-file HTML/CSS preview playgrounds unless the user explicitly requested a standalone HTML file.
3. **Integrate with Existing Styling**: Reuse project Tailwind classes, CSS variables, or component libraries already in place.

---

## 3. Surgical & Minimal Modifications (Ponytail Principle)

* **Deletion > Addition**: Prefer refactoring or extending existing utilities rather than introducing new redundant files.
* **No Stray Artifacts**: If a command or tool creates a transient log or test output file during verification, it must be deleted before the turn concludes.
* **Check Dirty Worktree**: Run `git status` or inspect changed files to ensure no unexpected garbage files are left behind.

---

## 4. Pre-Flight Checklist Before Every Turn Completion

Before reporting any task complete:
- [ ] No `tmp_*` / `scratch_*` / `preview.*` files left behind.
- [ ] All new files reside in standard, structured project directories.
- [ ] Automated tests, linter, and type checks pass cleanly.
- [ ] Working directory is clean and free of junk.
