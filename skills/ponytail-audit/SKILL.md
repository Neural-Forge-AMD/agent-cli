---
name: ponytail-audit
description: "Audit codebase for over-engineering, dead code, redundant abstractions, and unneeded dependencies."
risk: low
source: built-in
---

# Ponytail Audit: Codebase Simplification

Audit the codebase to eliminate bloat, unnecessary abstractions, and dead code.

## Audit Checklist

1. **Dead Code Scan**: Identify unused exports, dead files, and uncalled helper functions.
2. **Abstractions & Wrapper Layers**: Find single-use wrappers or unnecessary indirection layers that can be collapsed into straightforward direct calls.
3. **Redundant Dependencies**: Check `package.json` for external libraries whose functionality can be replaced with 2-3 lines of native code or stdlib.
4. **Boilerplate Reduction**: Consolidate duplicate patterns into single shared utilities.
5. **Report & Proposals**: Present candidate deletions and simplifications ordered by code reduction and maintenance savings.
