# V2 Runner Analysis

Source code remains authority. D2 maps provide navigation only. Current source has V1/V2 migration seams; absence from V2 is not evidence that V1 behavior is obsolete.

## 1. SystemPrompt

- **D2 component:** `runner.d2`: `System`, `Request`; `provider.d2`: resolved model.
- **Actual source path:** `packages/core/src/session/runner/llm.ts:173-176,202-229`; `packages/core/src/session/system.ts:15-45`.
- **Current flow:** Runner loads `SystemContext`, skills, and references through `loadSystemContext`; initializes/reconciles `SessionContextEpoch`; resolves model; builds request with explicit agent system or `SystemPrompt.provider(model)`, then `SystemPrompt.declaration(model)`, then durable context baseline.
- **Current behavior:** Provider prompt selection is implemented and tested. Explicit agent system replaces provider base prompt. V2 runner does not call V1 `SystemPrompt.environment`, `skills`, or `mcp`; V1 implementations remain in `packages/opencode/src/session/system.ts:51-135`.
- **Proposed change point:** V2 runtime context assembly around `loadSystemContext` and `runTurnAttempt` system construction. Do not modify provider selection helper for unrelated context parity.
- **Dependencies:** `AgentV2`, `SystemContextRegistry`, `SkillGuidance`, `ReferenceGuidance`, `SessionContextEpoch`, `SessionRunnerModel`, `Config`, `LLM`.
- **Tests:** `packages/core/test/session-system.test.ts:17-37`; runner request assertions in `packages/core/test/session-runner.test.ts`; V1 prompt tests in `packages/opencode/test/session/system.test.ts:112-166`.
- **Architectural impact:** Provider selection is component-level behavior. Adding V1 environment/skills/MCP semantics to V2 needs a runtime-context boundary decision; it is an architectural parity gap, not a local prompt edit.

## 2. Doom Loop

- **D2 component:** `runner.d2`: `Stream`, `Settle`, `Doom`.
- **Actual source path:** `packages/core/src/session/runner/publish-llm-event.ts:33-34,322-335,430-434`; `packages/core/src/session/runner/llm.ts:258-313`.
- **Current flow:** Each local tool call is published, streak is read synchronously, and the third consecutive identical call triggers `PermissionV2.assert({ action: "doom_loop" })` before settlement. Decline is converted to `DeclinedError`, interrupting continuation.
- **Current behavior:** Threshold is `3`. Identity is same tool name and input within one assistant message. Different call, input, or assistant message breaks streak. Third call is still recorded as interrupted/error when approval fails.
- **Proposed change point:** `DOOM_LOOP_THRESHOLD` and `repeatedToolCalls` in `publish-llm-event.ts`; permission/settlement handling in `llm.ts` only if semantics change.
- **Dependencies:** `LLMEvent` publisher, `PermissionV2`, `ToolRegistry` materialization/settlement, `EventV2`.
- **Tests:** `packages/core/test/session-runner.test.ts:2845-3130` covers third-call approval, decline, broken streak, differing calls, and post-threshold behavior.
- **Architectural impact:** Local component behavior. Threshold change does not justify D2 change or new boundary.

## 3. Ephemeral session.status

- **D2 component:** `session.d2`: `Runner`, `Busy`, `Idle`; `runner.d2`: `Drain`, `Events`.
- **Actual source path:** `packages/core/src/session/runner/llm.ts:425-465`.
- **Current flow:** Runner publishes `session.status` busy before drain. `Effect.ensuring` publishes idle and `SessionStatusEvent.Idle` after success, failure, or interruption.
- **Current behavior:** Status is live-only. No durable `session.status` rows are written. Force-run can publish status without pending durable inputs. Restart/recovery status is not represented.
- **Proposed change point:** For current semantics, `SessionRunner.run` status wrapper. For durable/recoverable status, change EventV2/session status ownership and recovery design first; do not patch runner alone.
- **Dependencies:** `EventV2`, `SessionStatusEvent`, `SessionRunCoordinator`, provider/tool interruption handling.
- **Tests:** `packages/core/test/session-runner.test.ts:3777-3880` covers busy/idle, force-run without durable rows, interruption, failure, and no durable status rows.
- **Architectural impact:** Current live status is component behavior. Durable status/recovery would be an architectural change. Existing `runner/llm.ts:54` explicitly calls durable status a future slice.

## 4. MCP visibility/parity

- **D2 component:** `mcp.d2`: `MCP`, `Defs`, `V1Tools`, `V1System`, `V2Registry`, `V2Runner`, `Gap`.
- **Actual source path:** V2 `packages/core/src/tool/registry.ts:42-121`; V2 runner `packages/core/src/session/runner/llm.ts:64-79,207-229`; V1 MCP `packages/opencode/src/mcp/index.ts:164-200`; V1 adapters `packages/opencode/src/session/tools.ts:41-79` and `session/system.ts:119-135`.
- **Current flow:** V2 runner calls core `ToolRegistry.materialize(agent permissions)`. Core registry combines application tools and location-local registrations. No V2 MCP client/instruction adapter is passed into request assembly. V1 MCP exposes clients, tools, instructions, prompts, and resources; V1 tools/system prompt adapt them.
- **Current behavior:** MCP visibility/parity is absent from V2 provider request. Runner source marks policy-filtered built-in, MCP, plugin, and structured-output definitions incomplete. V1 tests verify MCP instructions are omitted when all tools are denied (`packages/opencode/test/session/system.test.ts:112-166`).
- **Proposed change point:** First define V2 ownership for MCP discovery, registration, permission filtering, instruction context, and lifecycle. Then extend V2 location-scoped registry/context assembly. Do not make runner import V1 `MCP.Service` directly.
- **Dependencies:** MCP client state/config, permissions, plugin tools, `ToolRegistry`, `SystemContext`, location services, provider request.
- **Tests:** `packages/core/test/session-runner.test.ts` tool request/settlement coverage; `packages/opencode/test/session/system.test.ts:112-166`; `packages/opencode/test/mcp/*.test.ts`; core tool registry tests.
- **Architectural impact:** Architectural migration gap. This requires a supported V2 boundary, not only a new edge in `runTurnAttempt`.

## 5. Diagnostics

- **D2 component:** `overview.d2`: `Legacy.Diagnostics`; no V2 runner component.
- **Actual source path:** `packages/opencode/src/lsp/diagnostic.ts:20-27`; V1 prompt/runtime integration in `packages/opencode/src/session/prompt.ts`; no diagnostics dependency in `packages/core/src/session/runner/llm.ts`.
- **Current flow:** V1 LSP diagnostic formatting produces bounded `<diagnostics>` context. V2 runner does not collect, format, inject, persist, or publish diagnostics.
- **Current behavior:** Diagnostics remain package-opencode/V1-owned. Existing tests mostly stub LSP diagnostics; no dedicated V2 runner diagnostics behavior is present.
- **Proposed change point:** Decide whether diagnostics are a V2 `SystemContext` source, tool output, or session event before touching runner. If context, integrate through `SystemContextRegistry`/epoch rather than direct LSP calls in `runTurnAttempt`.
- **Dependencies:** LSP service, file/snapshot state, SystemContext, session history/epoch, permissions if exposed as tool.
- **Tests:** `packages/opencode/test/session/prompt.test.ts:139-146`; `packages/opencode/src/lsp/diagnostic.ts:20-27`; inspect codemode diagnostic tests separately. No V2 diagnostics test found.
- **Architectural impact:** Missing V2 capability/boundary. Formatting helper is local; making diagnostics visible to V2 model context is architectural.

## 6. Continuation / steer input

- **D2 component:** `session.d2`: `Admission`, `Wake`, `Coord`, `Steer`, `Queue`; `runner.d2`: `Continue`.
- **Actual source path:** Admission/wake `packages/core/src/session.ts:360-383`; promotion `packages/core/src/session/runner/llm.ts:192-200`; continuation `llm.ts:397-453`; coordinator `packages/core/src/session/run-coordinator.ts:67-103`.
- **Current flow:** `Session.prompt()` durably admits input, then wakes execution unless `resume:false`. Runner promotes steers at turn boundaries. Queue promotion takes one queued item, then promotes pending steers. After tool settlement or provider turn, history reloads through the next explicit `runTurn`; queued work follows continuation. Coordinator coalesces wakes per Session.
- **Current behavior:** Active steer becomes next provider-turn context. Multiple steers coalesce into one continuation turn. Queue remains durable and FIFO; one item promotes after continuation, before idle. Interrupted steer/queue inputs remain available for later resume.
- **Proposed change point:** Delivery semantics belong in `SessionInput` promotion and `SessionRunner` drain loop. Same-Session wake joining belongs in `SessionRunCoordinator`. Do not add a second prompt loop.
- **Dependencies:** `SessionInput`, `EventV2`, `SessionHistory`, `SessionContextEpoch`, `SessionRunCoordinator`, provider stream settlement.
- **Tests:** `packages/core/test/session-runner.test.ts:1914-2289`; `packages/core/test/session-prompt.test.ts:109-161,386-485`.
- **Architectural impact:** Current steer/queue behavior is component-level and matches D2. Crash recovery, remote ownership, bounded retries, or changed delivery vocabulary would be architectural work.

## 7. Architecture Findings

### Confirmed architecture

- Durable admission and model execution are separate: `packages/core/src/session.ts:360-383`.
- Process-local execution routes through location-scoped services and a per-session coordinator: `packages/core/src/session/execution/local.ts:10-35`.
- V2 runner owns provider-turn orchestration, tool settlement, continuation, and live status: `packages/core/src/session/runner/llm.ts:178-465`.
- Model resolution is location-scoped and uses catalog/integration services: `packages/core/src/session/runner/model.ts:181-218`.
- System context has durable epoch state and reconciliation/replacement behavior: `packages/core/src/session/context-epoch.ts:23-77`.
- V1 HTTP prompt handlers still call `SessionPrompt`: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295-327`.

### Implementation details

- Doom threshold value `3`.
- Provider family prompt matching.
- Busy/idle publication wrapper.
- Tool-call streak comparison and publisher bookkeeping.
- FIFO promotion mechanics.

These belong inside existing owners and do not require D2 expansion.

### Architectural gaps

- V2 context assembly lacks V1 environment/skills/MCP instruction parity.
- V2 tool materialization lacks MCP/plugin/structured-output parity.
- V2 runner has no diagnostics boundary.
- Durable status/restart recovery is unspecified.
- D2 initially collapsed Context Epoch into generic context and omitted stale-location fencing and interrupted-tool cleanup. Source proves these are meaningful runner boundaries.

### V1/V2 migration boundaries

- V1 `SessionPrompt` owns broad provider, MCP, tools, permissions, LSP, and legacy loop orchestration (`packages/opencode/src/session/prompt.ts:113-143`).
- V2 `SessionRunner` owns durable execution and explicit turns (`packages/core/src/session/runner/llm.ts:45-95`).
- V2 currently does not inherit V1 MCP/diagnostic behavior automatically.
- V2 has its own SystemPrompt provider helper; V1 has richer environment/skills/MCP service methods.

## 8. Recommended Implementation Order

1. **SystemPrompt/runtime-context boundary.** Establish V2 context ownership first; MCP visibility and diagnostics depend on it. Preserve explicit-agent-system precedence.
2. **MCP/tool parity.** Add V2-native discovery, registration, filtering, and instruction contracts after context ownership is explicit. Avoid direct V1 service coupling.
3. **Diagnostics.** Integrate diagnostics through chosen V2 context/event boundary, then add behavior tests. This depends on step 1 and may share step 2 context plumbing.
4. **Continuation/steer changes.** Current behavior is already explicit and tested. Change only if requirements differ; preserve durable admission and coordinator ownership.
5. **Ephemeral status recovery.** Keep live status unchanged while parity work lands. Design durable status/restart semantics separately before implementation.
6. **Doom-loop threshold.** Already correct and covered. Change last, only for a confirmed behavioral requirement.

## 9. D2 Changes

Updated D2 only where source inspection proved model omissions:

- `docs/architecture/session.d2` now needs explicit stale-location/run fencing and location-change relationship if those boundaries are shown in future edits.
- `docs/architecture/runner.d2` should show `ContextEpoch`, interrupted-tool cleanup, and stale-location abort as runner boundaries.

Current six-item ownership remains represented correctly. Doom threshold, live status, MCP gap, diagnostics absence, and steer/queue semantics do not require new component boxes.
