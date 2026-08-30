---
name: tdd
description: "Test-Driven Development workflow: RED-GREEN-REFACTOR cycle with minimal implementation steps."
risk: low
source: built-in
---

# Test-Driven Development (TDD)

## The RED-GREEN-REFACTOR Cycle

```
[RED: Failing Test] ──► [GREEN: Minimal Fix] ──► [REFACTOR: Clean Code]
```

### 1. RED Phase
- Write a concise, targeted unit test that defines the expected behavior.
- Run the test suite and confirm the new test fails for the expected reason.

### 2. GREEN Phase
- Write the minimum viable implementation required to turn the failing test green.
- Do not write extra features or anticipatory code.

### 3. REFACTOR Phase
- Clean up duplicate logic, improve naming, and simplify the implementation.
- Keep tests green at every refactor step.
