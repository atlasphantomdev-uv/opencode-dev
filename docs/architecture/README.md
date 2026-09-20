# Architecture maps

These diagrams exist as source-navigation and implementation-planning aids. They show major ownership boundaries and verified runtime relationships, not every module. Start with this README, then use `implementation-workflow.md`.

**Source code is authoritative; D2 is an architecture model and navigation/learning aid.** Tests and observed behavior outrank this model. If model conflicts with source, trust source, report discrepancy, fix diagram.

## Maps

- `overview.d2` — package boundaries, application assembly, V1/V2 migration seam, and UI/API boundary.
- `session.d2` — durable V2 admission, process-local execution routing, runner drain, state/events.
- `runner.d2` — one V2 provider turn, context/model/tool assembly, streaming, settlement, continuation.
- `provider.d2` — V2 model resolution and LLM boundary, plus legacy provider loader location.
- `mcp.d2` — MCP ownership: V1 transport/lifecycle plus the implemented V2 `McpV2` seam and host adapter.
- `implementation-workflow.md` — workflow for using maps before and after changes.

## Source areas

Core owns V2 durable session state, execution coordination, runner orchestration, model resolution, system context, and core tool registry. `packages/opencode` still owns V1 prompt orchestration, provider loader, agent/config/MCP integration, TUI/API assembly, and diagnostics adapters. This is an active migration seam, not a single unified runtime.

## Use before change

1. Select map matching feature boundary.
2. Read cited source symbols, not only diagram labels.
3. Trace callers, dependencies, state, events, and tests.
4. Identify owner and migration side before planning.
5. Treat unfilled V2 areas as questions, not invitations to infer behavior.

## Validation

Check every cited path exists. Check each arrow against imports/call sites. Check runtime claims against tests. Render with `d2 <file>.d2 <file>.svg` when D2 is installed. Do not add D2 dependency to repository.

## Known uncertainty

V1 and V2 coexist. V2 `SessionRunner` materializes core registry definitions plus MCP tools registered through the `McpV2` host seam; its own comments still mark policy-filtered plugin and structured-output parity incomplete (`packages/core/src/session/runner/llm.ts:70-73`). V1 `SessionPrompt` remains broad and owns MCP/tool/permission wiring (`packages/opencode/src/session/prompt.ts:113-143`). Diagnostics are a Core seam with a host adapter (`packages/core/src/lsp.ts`; `packages/opencode/src/lsp/capability.ts`), not a runner-owned subsystem. V2 doom-loop parity is implemented in runner settlement (`packages/core/src/session/runner/llm.ts:265-313`). V2 also re-validates Location/Context-Epoch after the provider request starts and at each tool settlement (`packages/core/src/session/runner/llm.ts:362-364,423-432`).
