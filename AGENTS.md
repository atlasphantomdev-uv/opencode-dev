# AGENTS.md

## Mission

This repository is an active V1 → V2 migration.

The primary goal is to restore behavioral parity with V1 while preserving the
V2 architecture. Changes must be evidence-driven, minimal, testable, and
limited to the requested scope.

When V1 and V2 behavior differ, do not assume V2 is correct because it is
newer. Treat V1 executable behavior and tests as the compatibility ground
truth unless an explicit migration decision documents otherwise.

---

# 0. Commands & workspace quirks

- **Never run tests from the repo root.** Root `bun test` is disabled by design (root `package.json` test script `exit 1`; root `bunfig.toml` `[test] root = "./do-not-run-tests-from-root"`). Run tests from the affected package.
- Root `bun typecheck` = `bun turbo typecheck` (all packages). Per-package typecheck is `tsgo --noEmit` (native `@typescript/native-preview`, not `tsc`); `packages/app` uses `tsgo -b`.
- Workspace dependency versions live in the root `package.json` `workspaces.catalog`; packages reference them as `catalog:`. Bump a version in the catalog, never in a single package.
- Install has a 3-day cooldown: root `bunfig.toml` sets `[install] exact = true` and `minimumReleaseAge = 259200`. A version published <3 days ago is rejected unless listed in `minimumReleaseAgeExcludes`.
- Many dependencies are locally patched (`patchedDependencies` → `patches/`). Do not bump a pinned version without reviewing its patch.
- App dev servers require `--conditions=browser`; the package `dev` scripts already set it.
- Generated SDK: after a public Protocol/Server HttpApi change run `bun run generate` from `packages/client`. CI gate `bun run check:generated` regenerates, then `git diff --exit-code -- src/generated src/generated-effect`.
- `packages/opencode` HttpApi gate: `bun run test:httpapi` (coverage + auth + effect modes). Web e2e: `bun --cwd packages/app test:e2e:local` (Playwright).
- Husky `pre-push` runs `bun knowledge:check` (advisory), asserts the Bun version from `packageManager`, then `bun typecheck`.

---

# 1. Operating Rules

## Repository Root

Work from the repository root when investigating architecture, dependencies,
or repository-wide behavior.

For package-local tests and typechecks, run commands from the affected package
directory when required by that package.

Always report the exact working directory and command used for verification.

## Before Changing Code

For non-trivial changes:

1. Inspect the relevant V1 implementation.
2. Inspect relevant V1 tests.
3. Trace the corresponding V2 implementation end-to-end.
4. Identify the exact behavioral difference.
5. State the invariant that must be preserved.
6. Implement the smallest V2-native change that restores the invariant.
7. Add regression coverage.
8. Verify the result.

Do not implement based only on names, comments, documentation, or assumptions
when executable behavior can establish the answer.

---

# 2. V1 → V2 Parity

When restoring behavior from V1 into V2:

- Treat V1 behavior as the compatibility ground truth unless an explicit
  migration decision says otherwise.
- Locate the exact V1 implementation before designing the V2 change.
- Locate relevant V1 tests before designing the V2 change.
- State the V1 invariant explicitly.
- Trace the equivalent V2 lifecycle/path.
- Identify the precise semantic regression.
- Distinguish behavioral differences from intentional architectural changes.
- Prefer the smallest V2-native implementation.
- Reuse existing V2 primitives.
- Do not recreate V1 subsystems merely to obtain parity.
- Do not introduce a second source of truth.
- Do not create parallel event buses, persistence systems, registries,
  coordinators, or abstractions when an existing V2 primitive already owns
  the responsibility.
- Preserve existing V2 ownership and dependency boundaries.
- Add regression tests for the behavioral invariant, not merely implementation
  details.
- Verify restart/recovery behavior whenever the invariant involves durability,
  persistence, ownership, or lifecycle state.
- Keep each parity fix independently scoped.

Every parity change should be explainable as:

V1 ground truth
→ V2 regression
→ invariant
→ smallest V2-native fix
→ regression tests
→ verification

---

# 3. Architecture Investigation

For architecture-sensitive work, inspect the repository's current architecture
and parity documentation before making changes.

Do not redesign architecture before understanding the existing system.

Before introducing a new abstraction, establish:

- what currently owns the responsibility;
- where the state lives;
- who creates it;
- who mutates it;
- who reads it;
- how lifecycle transitions occur;
- how errors/cancellation propagate;
- how restart/recovery behaves;
- which package owns the behavior;
- which existing primitive can be reused.

Prefer extending an existing ownership boundary over creating another one.

---

# 4. V2 Architectural Boundaries

Preserve the V2 architecture unless the requested task explicitly changes it.

## Dependency Direction

The dependency direction is:

Schema → Core/Protocol → Server

Client runtime may depend on Schema/Protocol but must not depend on Core/Server.

`sdk-next` may compose Client/Core/Server.

Do not introduce reverse dependencies.

## V2 Session Architecture

The following are architectural invariants:

- Durable prompt admission is separate from model execution.
- `SessionV2.prompt()` admits one durable `session_input` row before
  `SessionExecution.wake(sessionID)`, unless `resume:false`.
- Serialized runners promote admitted inputs at safe boundaries.
- Reusing a Session ID adopts the existing Session.
- Prompt message IDs are exact-retry identifiers only when Session/prompt/
  delivery identity matches.
- Conflicting reuse must fail rather than silently create divergent state.
- Historical projected prompts may lazily synthesize promoted inbox records.
- `SessionExecution` is process-global and Session-ID based.
- The local coordinator owns process-local Session coordination.
- Session placement occurs through SessionStore + LocationServiceMap when
  draining starts.
- Interruption targets the active process-local ownership chain.
- Idle/missing interruption is a no-op.
- SessionRunner/model/tool/permission/filesystem are Location-scoped.
- Omitted workspaceID means implicit-local.
- A provider turn uses one explicit `llm.stream(request)`.
- Projected history is reloaded before durable continuation.
- Do not reintroduce the legacy `SessionPrompt.loop`.
- Local Sessions drain process-locally until clustering.
- `SessionRunCoordinator` joins/coalesces wakes for the same Session and allows
  different Sessions to run concurrently.
- Advisory wakes drain durable inbox state.
- Post-crash continuation recovery requires explicit design before retrying
  provider work.
- A drain has no durable identity/transcript boundary unless explicitly
  designed otherwise.
- Delivery vocabulary must remain explicit:
  steers by default; queued inputs promote at the next safe provider-turn
  boundary.
- Queued input remains pending until the Session is idle.
- One queued input is promoted and continuation is reevaluated.
- New user input resets the selected agent's provider-turn allowance.
- Batch steering resets the allowance once.
- EventV2 replay ownership is separate from clustered Session execution
  ownership.
- System Context algebra/registry/built-ins remain under `src/system-context`.
- Context Sources declare their observed domains.
- Session History owns history selection.
- Context Epoch persistence is Session-owned.

Do not weaken or bypass these boundaries for convenience.

---

# 5. Scope Discipline

Only change what the task requires.

Do not combine:

- unrelated bug fixes;
- opportunistic refactors;
- cleanup;
- formatting-only changes;
- dependency upgrades;
- architectural rewrites;
- migration of unrelated V1 behavior.

If investigation discovers an unrelated issue:

1. document it;
2. leave it untouched;
3. mention it in the final report.

A parity fix must remain independently reviewable.

---

# 6. Implementation Style

Prefer simple, direct code.

- Prefer one function unless decomposition provides genuine reuse or
  composability.
- Do not extract single-use helpers preemptively.
- Prefer early returns over unnecessary `else`.
- Keep the main happy path obvious.
- Use small helpers only for genuinely complex supporting logic.
- Avoid unnecessary destructuring.
- Avoid aliases when the original name is clear.
- Avoid star imports.
- Prefer type inference.
- Avoid `any`.
- Prefer Bun APIs where appropriate.
- Prefer functional array methods.
- Avoid unnecessary variable creation.
- Avoid `try/catch` unless required for actual error handling.
- Do not introduce Effect into synchronous helpers.
- In Effect generators, bind services to named variables rather than nesting
  yields.
- Prefer schema helpers over manual JSON parsing and `Effect.try`.
- Use dynamic imports for heavy startup-sensitive modules where appropriate.
- Comments should explain non-obvious constraints, not restate the code.
- Follow existing local conventions before introducing new patterns.
- Drizzle columns use snake_case.

Do not optimize for fewer lines at the expense of clarity or correctness.

---

# 7. SDK / Generated Code

The SDK is generated from the source definitions.

When changing a public Protocol or Server HttpApi:

1. Change the source definition.
2. Run the appropriate generation workflow.
3. Regenerate the SDK.
4. Verify generated output.

Generation:

`./packages/sdk/js/script/build.ts`

After a public Protocol or Server HttpApi change, run:

`bun run generate`

from:

`packages/client`

Never manually edit:

- `src/generated`
- `src/generated-effect`

Generated changes must come from the generator.

---

# 8. Testing

Tests must validate behavior, not merely reproduce implementation logic.

Prefer real implementations over mocks.

Avoid mocks unless there is a concrete reason they are required.

Do not use `globalThis` in tests unless there is no practical alternative.

For parity work, tests should prove the invariant at the boundary where the
behavior matters.

Where applicable, test:

- normal behavior;
- edge cases;
- failure behavior;
- cancellation;
- repeated operations;
- lifecycle transitions;
- persistence;
- restart/reload;
- recovery;
- stale state;
- concurrency/coalescing;
- terminal-state behavior.

For durable state, a test that only checks an in-memory object is insufficient.

For restart/recovery semantics, simulate reconstruction from durable state.

Do not write a test that simply duplicates the implementation algorithm.

---

# 9. Verification

Verification is mandatory for code changes.

At minimum:

1. Run targeted tests for the changed behavior.
2. Run the affected package test suite.
3. Run broader/core tests when appropriate.
4. Run package typecheck.
5. Run formatting checks.
6. Run relevant lint/static analysis.

Tests and typechecks must be run from the package directory when required.

Never run `tsc` directly when the repository provides a package typecheck
command.

Use:

`bun typecheck`

from the appropriate package directory.

## Failure Classification

Separate:

- failures introduced by the change;
- failures caused by the environment;
- pre-existing failures;
- unrelated warnings.

Do not hide failures merely because they existed before the change.

If a verification command fails, determine whether the failure is related to
the change before claiming completion.

---

# 10. Git / Branches

Default branch:

`dev`

Do not assume a local `main` branch exists.

Use `dev` / `origin/dev` when establishing repository history.

Branch names:

- maximum 3 words;
- hyphenated;
- no slash;
- no type prefixes.

Follow conventional commit style.

Keep commits focused and reviewable.

---

# 11. Final Report

Every non-trivial implementation task must end with a concise evidence-based
report.

For parity work use:

## Ground Truth

What V1 actually does, with file/test references.

## V2 Regression

What V2 currently does differently.

## Invariant

The exact behavior that must be preserved.

## Implementation

What changed and why it is the smallest V2-native fix.

## Tests

What regression tests were added and what they prove.

## Verification

Exact commands and results.

## Pre-existing Failures

Anything failing independently of the change.

## Scope

What was intentionally not changed.

Do not claim parity from code inspection alone when the behavior can be tested.

---

# 12. Stop Conditions

Stop and investigate instead of guessing when:

- V1 and V2 ownership are unclear;
- the durable source of truth is unclear;
- lifecycle transitions are unclear;
- a proposed fix requires a new subsystem;
- existing V2 primitives appear insufficient;
- tests contradict implementation behavior;
- restart/recovery semantics are ambiguous;
- the change would cross package dependency boundaries;
- the requested change appears to require an architectural decision.

Do not silently invent behavior.

If an architectural decision is genuinely required, document the evidence and
surface the decision before expanding the implementation.

---

# 13. Priority Order

When rules conflict, prioritize:

1. Correct observable behavior.
2. V1 compatibility for migration work.
3. Existing V2 architectural ownership.
4. Data/state integrity and durability.
5. Regression coverage.
6. Minimal implementation.
7. Repository style preferences.
8. Cosmetic cleanup.

Never sacrifice correctness or architectural integrity merely to satisfy a
style preference.

## Repository knowledge navigation

Before broad repository exploration, read `.knowledge/index.md` and only the
focused documents relevant to the task. Treat knowledge as navigation/context,
not authority. Verify implementation-critical assumptions against current source
and tests; source wins on disagreement. After changes, review affected curated
notes in `script/knowledge/catalog.ts`, run `bun knowledge:update`, then
`bun knowledge:validate`. Do not load every knowledge document by default.
