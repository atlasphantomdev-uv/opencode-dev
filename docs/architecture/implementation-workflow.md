# Implementation workflow

```text
UNDERSTAND
    ↓
READ RELEVANT ARCHITECTURE
    ↓
TRACE ACTUAL SOURCE
    ↓
IDENTIFY BOUNDARY / OWNERSHIP
    ↓
PLAN CHANGE
    ↓
IMPLEMENT
    ↓
RUN TESTS
    ↓
REVIEW DIFF
    ↓
VERIFY BEHAVIOR
    ↓
CHECK ARCHITECTURE
    ↓
UPDATE D2 ONLY IF ARCHITECTURE CHANGED
```

## Before implementation

Choose smallest relevant map. Read source paths and symbols cited there. Trace entry, callers, dependencies, state, events, external boundaries, and tests. Confirm whether path is V1 or V2. State invariant and owning module before code plan.

## Update D2 when

- new architectural component appears;
- major dependency or boundary changes;
- runtime flow changes;
- ownership moves between modules/packages;
- external integration boundary changes;
- durable state or event ownership changes.

Internal refactor with no architectural impact normally does not update D2. New function, renamed helper, or local optimization is not enough.

## Validation loop

1. Re-read changed source and affected tests.
2. Update only impacted diagram.
3. Check all paths still exist.
4. Check arrows against imports/call sites.
5. Render with `d2 docs/architecture/<name>.d2 /tmp/<name>.svg` if D2 exists.
6. Record uncertainty instead of inventing relationship.

Source outranks tests; tests/observed behavior outrank D2; D2 supports navigation and planning. Never change source to satisfy diagram.

## V2 runner case-study checklist

Trace `SessionInput.admit` before `SessionExecution.wake`; follow `SessionRunCoordinator` into location-scoped `SessionRunner`; inspect `runTurnAttempt` for context epoch, history, model, tools, request, stream, settlement, doom-loop permission, and continuation. Separately inspect V1 `SessionPrompt`, `SystemPrompt`, `SessionTools`, and `MCP` before assuming parity.
