---
name: systematic-debugging
description: "Disciplined root-cause debugging methodology. Mandatory 4-phase investigation before attempting code fixes."
risk: low
source: built-in
---

# Systematic Debugging

## Core Principle

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

Random trial-and-error fixes waste time and create regressions. Always isolate the root cause before editing code.

## The 4 Phases of Debugging

### Phase 1: Root Cause Investigation
1. **Read errors and logs completely**: Analyze stack traces, line numbers, error codes, and symptoms.
2. **Reproduce the bug reliably**: Formulate a minimal reproduction test or shell command.
3. **Trace data flow end-to-end**: Trace inputs from entry boundary to failure point.

### Phase 2: Hypothesis & Verification
1. Formulate a specific hypothesis explaining why the failure occurs.
2. Test the hypothesis using logs, asserts, or focused diagnostics.

### Phase 3: Surgical Fix
1. Fix the underlying root cause at the source, not just the symptom.
2. Ensure the fix is minimal and edge-case correct.

### Phase 4: Regression Prevention
1. Run the reproduction test and confirm it now passes.
2. Run the entire test suite to ensure zero collateral breakage.
