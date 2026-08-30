---
name: verification-before-completion
description: "Mandatory pre-completion verification protocol: execute automated tests, linter, and type checks before reporting completion."
risk: low
source: built-in
---

# Verification Before Completion

## The Iron Rule of Completion

```
NEVER REPORT A TASK COMPLETE WITHOUT RUNNING RUNNABLE VERIFICATION FIRST
```

Before declaring any task or ticket completed to the user:

1. **Run Unit Tests**: Execute `bun test` / `npm test` and verify 0 failures.
2. **Run Typecheck & Linter**: Ensure no compile or type errors exist.
3. **Verify Edge Cases**: Check boundary conditions and error paths.
4. **Clean up Scratch Artifacts**: Remove temporary debug logs and scratch files.
