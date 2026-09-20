# V2 Context Design

Source code and existing V2 specifications remain authority. This design narrows ownership before implementation. It does not authorize code changes.

## 1. Current V1/V2 Ownership

| Concern                | V1 owner                                                                                     | V2 owner/current path                                                                                                     | Boundary status                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| System prompt          | `packages/opencode/src/session/system.ts:27-135`, assembled by `SessionPrompt`               | `packages/core/src/session/system.ts:15-45`; request assembly in `packages/core/src/session/runner/llm.ts:220-226`        | Provider base/declaration native; richer runtime parity partial |
| Agent configuration    | `packages/opencode/src/agent/agent.ts`, `SessionPrompt`                                      | `packages/core/src/agent.ts:17-43`; selected by runner at `llm.ts:187`                                                    | Native V2 selection                                             |
| Model/provider         | `packages/opencode/src/provider/provider.ts:1213,1385`; legacy loader                        | `packages/core/src/session/runner/model.ts:181-218`; Catalog + Integration                                                | Native V2 resolution; V1 loader remains separate                |
| Tools                  | `packages/opencode/src/session/tools.ts:41-112`, V1 registry                                 | `packages/core/src/tool/registry.ts:42-123`                                                                               | Native V2 registry and settlement                               |
| MCP                    | `packages/opencode/src/mcp/index.ts:164-200`; V1 clients, tools, instructions, resources     | Core seam `McpV2` (`packages/core/src/mcp.ts`) + host adapter (`packages/opencode/src/mcp/capability.ts`); runner composes instructions at `llm.ts:254-261`, `McpV2.toolsNode` registers tools | Implemented seam; adapter is host-scoped                        |
| Permissions            | V1 `Permission` used by prompt/tools                                                         | `packages/core/src/permission.ts:92-218`; materialization filters and `PermissionV2.assert` authorizes calls              | Native V2 policy boundary                                       |
| Skills/environment     | V1 `SystemPrompt.environment/skills/mcp` in `packages/opencode/src/session/system.ts:51-135` | `SystemContextRegistry`, `SkillGuidance`, `ReferenceGuidance` loaded by `llm.ts:173-176`                                  | Context source migration partial                                |
| Session metadata       | V1 session/message services and prompt processor                                             | V2 Session/Store/history plus publisher; `packages/core/src/session/runner/llm.ts:234-243`                                | Native durable state                                            |
| Location/context epoch | V1 instance/location state                                                                   | `LocationServiceMap`, `SessionContextEpoch`; `packages/core/src/session/context-epoch.ts:23-77`, `llm.ts:184-205`         | Native V2; location fencing at `llm.ts:184-186`                 |
| Diagnostics            | V1 LSP formatter/runtime, `packages/opencode/src/lsp/diagnostic.ts:20-27`                    | Core seam `LspV2` (`packages/core/src/lsp.ts`) + host adapter (`packages/opencode/src/lsp/capability.ts`); V2 `edit`/`write`/`apply_patch` append the report | Implemented seam; adapter is host-scoped                        |
| Continuation/steer     | V1 `SessionPrompt.loop` and prompt processor                                                 | `SessionInput`, `SessionExecution`, coordinator, runner; `packages/core/src/session.ts:360-383`, `llm.ts:192-200,397-453` | Native V2 execution ownership                                   |

V1 `SessionPrompt` remains a broad orchestrator (`packages/opencode/src/session/prompt.ts:113-143`). V2 intentionally separates durable admission, coordination, context, model resolution, tools, and provider execution.

## 2. Problems With Current V2 Context

Verified gaps only:

1. V2 request assembly combines provider prompt, declaration, and `ContextEpoch` baseline, plus environment, discovered instructions, skills, references, MCP instructions, and plan/build reminders. Configured local/remote instruction sources remain open. Canonical checklist: `specs/v2/session.md:123-151`.
2. V2 tool materialization uses core application/local registrations plus MCP tools registered by `McpV2.toolsNode`. Runner source still marks policy-filtered plugin and structured-output definitions incomplete: `packages/core/src/session/runner/llm.ts:70-73`.
3. Diagnostics are implemented as a Core seam with a host adapter: `LspV2.report` supplies v1-worded blocks that the V2 `edit`/`write`/`apply_patch` leaves append to their model output (`packages/core/src/lsp.ts`; `packages/opencode/src/lsp/capability.ts`).
4. `SessionContextEpoch` is correctly separate from request assembly, but D2 must distinguish registry composition, epoch persistence, and per-turn request assembly. `packages/core/src/system-context/registry.ts:12-44`; `context-epoch.ts:40-77`.
5. Location and tool stale-fencing are separate concerns. Runner checks current Session location before turn; ToolRegistry captures registration identity and rejects stale calls: `packages/core/src/session/runner/llm.ts:184-186`; `packages/core/src/tool/registry.ts:106-121`.

No source evidence supports replacing V2 runner ownership or reintroducing V1 `SessionPrompt.loop`.

## 3. Proposed V2 Context Boundary

Create one conceptual V2 **execution context assembly boundary**. It need not be one new service initially. Existing owners compose it at the location-scoped runner boundary.

### Components

1. **SessionExecutionContext assembler** — conceptual boundary called by runner at provider-turn start. It samples session, selected agent, model, effective permissions, location, context epoch, history boundary, and effective capabilities.
2. **SystemContextRegistry** — location-scoped generic source registry. It does not currently own environment, instruction, reference, or skill implementations; those must register through this seam. Existing primitive: `packages/core/src/system-context/registry.ts:12-44`.
3. **SessionContextEpoch** — Session-owned durable baseline/snapshot and reconciliation. It admits context changes at safe provider-turn boundaries: `packages/core/src/session/context-epoch.ts:23-77`.
4. **Capability resolver** — location-scoped tool/MCP/plugin capability materializer. Existing V2 `ToolRegistry` owns effective registration, wholly-denied filtering, settlement, output bounding, and stale registration rejection: `packages/core/src/tool/registry.ts:42-123`. MCP parity must join this boundary through a V2-native registration/adapter seam; broader MCP/plugin filtering is not implemented yet.
5. **Request policy snapshot** — immutable per provider turn: selected agent, selected model, effective permissions, advertised tool definitions, context baseline, and request options.

The runner consumes assembled values and coordinates turns. It does not become owner of environment discovery, MCP lifecycle, LSP, config file parsing, or provider SDK loading. This assembled value is a design target, not a current public type; current code resolves values inline in `packages/core/src/session/runner/llm.ts:184-229`. Keep first implementation private to runner module unless a second caller requires extraction.

## 4. Runner Contract

### Explicit design answers

1. **Runner input:** session ID/force remains public; private turn assembly supplies immutable session location, agent, model, permissions, epoch baseline, history, capabilities, options, and promotion.
2. **Runner responsibility:** safe-boundary promotion, context preparation, history reload, one provider stream, event publication, tool settlement, interruption, compaction transition, continuation, and live status.
3. **Outside runner:** admission, coordination, config discovery, provider SDK/auth, MCP lifecycle, LSP lifecycle, source loaders, and durable snapshot internals.
4. **Context constructors:** existing `AgentV2`, `SessionRunnerModel`, `SystemContextRegistry`, `SessionContextEpoch`, `ToolRegistry`, and `PermissionV2`; first slice keeps composition private to runner module.
5. **Immutable per turn:** selected agent/settings, model/provider/variant, effective permissions, location identity, epoch baseline/sequence, projected history, capability definitions/registration identities, and request options.
6. **Change during continuation:** newly promoted steer/queue input, reloaded history, settled tool results, context-source reconciliation, model/agent selection for next turn, and capability registrations between turns. Never mutate current provider request.
7. **MCP/tool resolution:** location-scoped V2 capability adapter and `ToolRegistry`; runner receives materialized definitions and settles through registry.
8. **Permission resolution:** `PermissionV2` evaluates agent/project policy and approvals; registry filters wholly denied definitions; runner supplies identity only.
9. **Diagnostics entry:** initial design uses location-scoped collector producing volatile per-turn observation; runner consumes observation in private snapshot, not LSP directly or Context Epoch.
10. **Epoch/fencing:** registry composes sources; epoch persists baseline/snapshot; runner checks location before turn; move invalidates effective location; ToolRegistry independently rejects stale capability registrations; cleanup fails interrupted tools.
11. **V1 reusable:** pure provider prompt semantics and pure diagnostic formatting as references/adapters; V1 behavior can guide parity tests.
12. **V1 not reusable:** `SessionPrompt`/loop, `SessionTools.resolve`, V1 `MCP.Service` as runner dependency, V1 provider model resolution, and V1 LSP lifecycle.
13. **Minimum before MCP parity:** define scoped V2 MCP adapter registration into `ToolRegistry` plus instruction registration into `SystemContextRegistry`, including lifecycle/removal and layer ordering.
14. **Minimum before diagnostics:** define location-scoped diagnostic observation contract, stale/clear behavior, and per-turn snapshot tests; keep collector outside runner and out of Context Epoch.
15. **Architectural vs ordinary:** new MCP/diagnostic source and capability boundaries, durable status/recovery, or migration route changes are architectural. Threshold, prompt rendering, per-turn assembly, status publication, and promotion mechanics are ordinary component changes within existing owners.

### Runner input

Current public contract remains session identity plus force flag: `packages/core/src/session/runner/index.ts:19-28`. Internally, each `runTurnAttempt` should consume an assembled turn context containing:

- Session identity and location identity;
- selected agent identity and immutable agent request settings;
- resolved model/provider reference and variant;
- effective permission policy reference/snapshot;
- Context Epoch baseline and baseline sequence;
- projected chronological history;
- effective tool/capability materialization with registration identities;
- provider request options;
- continuation/promotion result for this turn.

Do not expose raw mutable registries or V1 service objects as runner input.

### Runner responsibilities

- Check location validity before turn execution.
- Promote admitted steer/queue input at safe boundaries.
- Ask context epoch to initialize/reconcile/replace baseline.
- Reload projected history.
- Request one provider stream.
- Publish provider events and durable session events.
- Settle local tools through the capability boundary.
- Handle interruption, stale tool calls, compaction transitions, and continuation.
- Publish ephemeral busy/idle status.

### Outside runner

- Durable prompt admission and identity conflict handling: `packages/core/src/session.ts:360-383` and `session/input.ts:41-81`.
- Wake coalescing and same-session serialization: `packages/core/src/session/run-coordinator.ts:67-103`.
- Config discovery and parsing: `packages/core/src/config.ts:29-154`.
- Provider SDK loading and authentication.
- MCP client lifecycle and transport.
- LSP process lifecycle and diagnostic collection.
- Durable source snapshot storage internals.

## 5. Tool/MCP Boundary

### Tools

`ToolRegistry` owns effective named registration, wholly-denied filtering for advertised definitions, registration identity capture, settlement, output bounding, and stale-call rejection. This matches `specs/v2/tools.md:135-180`; broader MCP/plugin policy parity remains incomplete.

### MCP

MCP should enter V2 through capability registration and context-source registration, not direct runner calls:

1. Location-scoped MCP integration discovers/maintains clients.
2. MCP adapter registers tool capabilities into V2 `ToolRegistry` with Scope lifetime.
3. Adapter registers MCP instructions as a V2 `SystemContext` source, with stable key and removal semantics. This design chooses durable source semantics because model-visible context is persisted and replayed; volatile request-only instructions would not preserve later-turn behavior.
4. Capability materialization applies effective agent/session permissions.
5. Runner receives definitions and settles calls through `ToolRegistry`.

Do not make `SessionRunner` depend on V1 `MCP.Service`. V1 `MCP.Service` owns transport, auth, resources, prompts, and mutable client state (`packages/opencode/src/mcp/index.ts:142-184`), which would restore monolithic ownership.

### Permissions

`PermissionV2` remains policy owner. It resolves configured agent permissions and saved project rules, emits approval events, tracks pending requests, and authorizes calls (`packages/core/src/permission.ts:137-218`). Tool materialization filters wholly denied capabilities; trusted tools call permission assertions for sensitive actions. The runner supplies stable Session/agent/message/call identity but does not evaluate policy itself.

## 6. System Prompt Boundary

Separate three layers:

1. **Provider baseline selector:** `SystemPrompt.provider(model)` and `declaration(model)` remain pure model/request assembly helpers (`packages/core/src/session/system.ts:15-45`). Explicit agent system prompt keeps precedence as current runner behavior (`llm.ts:220-226`).
2. **Durable baseline context:** registered `SystemContext` sources produce typed values; `SessionContextEpoch` renders and persists exact baseline/snapshot. Environment facts, instructions, references, and selected-agent skill guidance belong here only after each source has an explicit loader, stable key, codec, and unavailable/removal semantics.
3. **Chronological request context:** promoted user input, tool results, and admitted mid-conversation system messages remain history/request assembly, not registry state.

The runner joins these layers into `LLM.request`; it does not discover files, inspect environment, load skill bodies, or format MCP instructions itself.

## 7. Diagnostics Boundary

Diagnostics should initially enter as a V2 **volatile diagnostic observation**, not a durable `SystemContext` source:

- A location-scoped diagnostic collector observes LSP/compiler state. Existing LSP service remains collector owner; no LSP process owner belongs in runner.
- A per-turn observation may be captured for model visibility without entering durable epoch state.
- Existing pure formatter can be reused initially, but LSP service/client lifecycle must remain outside runner.

Do not inject diagnostics directly in `runTurnAttempt`, persist them as arbitrary tool output, or make runner own LSP processes. If future UX requires durable semantic diagnostics, design a separate source/event contract with explicit retention and removal semantics rather than treating volatile observations as ordinary Context Epoch state.

## 8. Context Epoch / Stale Location

- `SystemContextRegistry` composes current location-scoped sources.
- `SessionContextEpoch.initialize` creates first baseline/snapshot.
- `prepare` reconciles updates and replaces baseline after compaction: `packages/core/src/session/context-epoch.ts:40-77`.
- Runner uses baseline sequence to select history and includes baseline in request: `packages/core/src/session/runner/llm.ts:188-227`.
- Session location is checked before turn; stale placement interrupts execution: `llm.ts:184-186`.
- Session move publishes durable location change: `packages/core/src/control-plane/move-session.ts:77-111`.
- Tool registration identity fencing is independent and rejects stale calls: `packages/core/src/tool/registry.ts:106-121`.
- Interrupted provider/tool work is marked failed by runner cleanup: `packages/core/src/session/runner/llm.ts:124-144,337-357`.

One provider-turn context is immutable after assembly. A new provider turn may resample agent/model/capabilities/context sources. Durable Context Epoch remains the continuity anchor; location change requires destination-scoped re-resolution and complete baseline preparation before promotion, per `CONTEXT.md:117-134`.

## 9. V1 Compatibility

### Safe temporary reuse

- Provider-family prompt semantics, preferably through copied/pure V2 helper behavior already in `packages/core/src/session/system.ts`.
- Pure diagnostic formatting from `packages/opencode/src/lsp/diagnostic.ts`, if output contract remains suitable.
- V1 environment/skills/MCP rendering semantics as behavioral references and migration tests, not as direct service dependencies.

### Do not reuse in V2 runner

- `SessionPrompt.Service` or `SessionPrompt.loop`.
- V1 `SessionTools.resolve` and its processor/EffectBridge ownership.
- V1 `MCP.Service` as a runner dependency.
- V1 provider service for model resolution.
- V1 LSP runtime/client lifecycle.

V1 HTTP prompt routes can continue using V1 while V2 endpoints use `SessionV2` and `SessionExecution`. This coexistence is visible at `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295-327` and assembly at `server.ts:299-303`.

## 10. Migration Strategy

1. Freeze current V2 contract and add context-assembly tests around existing SystemContext/Epoch behavior.
2. Formalize per-turn context as an internal value assembled from existing V2 services; avoid new public API initially.
3. Move/complete environment, instructions, references, and selected-agent skill guidance as scoped SystemContext sources.
4. Define V2 MCP capability and instruction registration using existing ToolRegistry/SystemContextRegistry Scope semantics.
5. Add MCP request/settlement parity tests, including wholly denied tools, stale registration, disconnect/removal, and continuation. Do not broaden `ToolRegistry` permission semantics in same slice.
6. Add volatile diagnostic observation integration after context-source lifecycle is proven.
7. Keep continuation, status, doom-loop, location fencing, and interrupted-tool cleanup unchanged unless regression tests expose a concrete mismatch.
8. Only then consider replacing V1 route ownership for selected flows.

## 11. Implementation Plan

### Step 1 — Internal turn-context assembly

- **Files:** `packages/core/src/session/runner/llm.ts:173-229`; `packages/core/src/session/runner/index.ts:19-28`; `packages/core/src/session/runner/model.ts:181-218`.
- **Change:** Name/document internal assembled turn context. Keep public `run({ sessionID, force })` unchanged. Assemble agent, model, epoch, history, permissions, tools, and request settings before `LLM.request`.
- **Dependencies:** Existing `AgentV2`, `SessionRunnerModel`, `SystemContextRegistry`, `SessionContextEpoch`, `ToolRegistry`, `PermissionV2`.
- **Tests:** Existing `packages/core/test/session-runner.test.ts`; add request snapshot assertions for agent override, baseline sequence, model, permissions, and tool definitions.
- **Architectural impact:** Clarifies existing boundary; no new subsystem.
- **Risk:** Accidental resampling during one turn. Freeze values after assembly.
- **Verification:** Targeted runner tests; inspect one provider request and durable epoch/history state.

### Step 2 — Complete V2 context sources

- **Files:** `packages/core/src/system-context/index.ts:31-77`; `system-context/registry.ts:12-44`; `packages/core/src/session/context-epoch.ts:40-77`; existing `packages/core/src/skill/guidance.ts`, `reference/guidance.ts`.
- **Change:** Add only source implementations required by parity checklist: environment, configured/upward instructions, references, and selected-agent skill guidance. Keep skill bodies in permission-checked tool path.
- **Dependencies:** Location, Config, Skill, Reference, AgentV2, filesystem/instruction services.
- **Tests:** `packages/core/test/system-context/*.test.ts`; add unavailable/removal/reconciliation and agent-switch boundary tests.
- **Architectural impact:** Adds context-source implementations within existing boundary.
- **Risk:** Durable baseline/replay drift or stale location data.
- **Verification:** Restart/reload and compaction tests; compare exact baseline/update text.

### Step 3 — V2 MCP capability boundary

- **Files:** `packages/core/src/tool/registry.ts:42-123`; `packages/core/src/system-context/registry.ts`; V2 location/plugin/MCP integration seam to be identified before coding; V1 reference `packages/opencode/src/mcp/index.ts:164-200`.
- **Change:** Define scoped MCP adapter that registers tools and instruction source; keep transport/client lifecycle outside runner.
- **Dependencies:** MCP config/client/auth, Scope, ToolRegistry, PermissionV2, SystemContextRegistry, plugin layer ordering.
- **Tests:** New core MCP adapter tests; existing `packages/opencode/test/mcp/*.test.ts` for behavioral parity; denied visibility, disconnect, stale registration, and continuation tests.
- **Architectural impact:** New V2 integration boundary; highest design risk.
- **Risk:** Reintroducing V1 mutable service ownership or layer cycle. Resolve layer ordering before implementation.
- **Verification:** Tool definitions in request, permission filtering, safe cleanup on scope close, stale-call rejection.

### Step 4 — V2 diagnostics observation

- **Files:** `packages/opencode/src/lsp/diagnostic.ts:20-27` for pure formatting reference; V2 `packages/core/src/system-context` and location/LSP integration owner after Step 3.
- **Change:** Add location-scoped diagnostic observation adapter supplying optional per-turn snapshot input. Keep LSP process/client lifecycle outside runner and do not register observations in Context Epoch.
- **Dependencies:** LSP service, filesystem/location, private turn snapshot boundary.
- **Tests:** New V2 diagnostic observation tests for available, stale/cleared, bounded, and changed diagnostics; runner request tests.
- **Architectural impact:** New V2 boundary.
- **Risk:** Leaking stale workspace diagnostics or accidentally persisting volatile observations.
- **Verification:** Per-turn capture, location move isolation, no Context Epoch/event rows from observation changes.

### Step 5 — Migration and parity gate

- **Files:** V2 route/session integration after Steps 1–4; V1 `packages/opencode/src/session/prompt.ts` remains unchanged during initial slices.
- **Change:** Selectively route V2 callers only after parity evidence exists.
- **Dependencies:** API contracts, TUI/event consumers, compatibility tests.
- **Tests:** V2 session integration, TUI/event tests, V1 regression suite.
- **Architectural impact:** Migration boundary change.
- **Risk:** Dual-runtime behavioral divergence.
- **Verification:** End-to-end prompt, steer, queue, MCP, diagnostics, interruption, and restart cases.

## 12. Explicit Non-Goals

- Do not implement code in this design task.
- Do not reintroduce `SessionPrompt.loop`.
- Do not move all V1 services into Core wholesale.
- Do not make runner own Config, MCP transport, plugin lifecycle, LSP, or filesystem discovery.
- Do not change doom-loop threshold `3`.
- Do not change current steer/queue vocabulary or coordinator semantics.
- Do not make ephemeral status durable without separate recovery design.
- Do not add dependencies, alter package manifests, or change public HTTP/SDK contracts.
- Do not treat every model-visible string as a durable Context Source; chronological history and per-turn request assembly remain distinct.

## 13. Open Questions

1. Which existing V2 location/plugin layer should host MCP client lifecycle without creating the documented `PluginBoot -> Tools -> PluginBoot` cycle? `specs/v2/tools.md:182-184` identifies ordering work. This blocks Step 3.
2. What exact provider/model option and authentication data must be frozen in turn context versus re-resolved between turns? This affects request retry and model-switch semantics.
3. Does Context Epoch require stronger generation/CAS fencing for concurrent preparation, or do current Session coordinator and event commit boundaries suffice? `packages/core/src/session/context-epoch.ts:40-77` does not expose generation CAS. This blocks concurrent context-source implementation only if prepares can occur outside coordinator.

Decisions made here: MCP instructions use durable `SystemContext` source semantics; diagnostics initially use volatile per-turn observation, not `SystemContext`; existing LSP service collects diagnostics; no new public `SessionExecutionContext` service is required for first slice; current `PermissionV2` remains policy owner and `ToolRegistry` retains existing wholly-denied filtering contract.
