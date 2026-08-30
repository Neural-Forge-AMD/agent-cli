---
name: executing-plans
description: "Execute implementation plans with strict adherence to checkpoints and incremental test validation."
risk: low
source: built-in
---

# Executing Plans

## Execution Protocol

1. **Step-by-Step Execution**: Execute one task item at a time in logical dependency order.
2. **Immediate Checkpoint Testing**: Verify each change immediately after modifying code.
3. **No Unplanned Scope Creep**: Stick strictly to the agreed plan; if unexpected blockers occur, halt and report.
