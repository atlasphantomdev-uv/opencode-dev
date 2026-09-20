# V2 Context Contract

Source code remains authority. This contract is design-only; it does not change runtime behavior.

## 1. Architectural Boundary

```text
DISCOVERY
  → CONTEXT ASSEMBLY
  → IMMUTABLE TURN SNAPSHOT
  → RUNNER
  → CONTINUATION / EVENTS
```

- **Discovery** reads current location-scoped services: agent, model/integration, registered capabilities, permission policy, context sources, session metadata, and pending delivery state.
- **Context assembly** runs after safe-boundary promotion and Context Epoch preparation. It combines discovery outputs with projected history and request options.
- **Immutable Turn Snapshot** freezes all provider-visible inputs and registration identities for one provider attempt. This is a private internal value, not a public service.
- **Runner** streams one provider turn, publishes events, settles tools, handles interruption/compaction, and decides whether continuation is needed.
- **Continuation / Events** owns mutable drain state: promotion kind, step allowance, pending steers/queues, tool fibers, wake coalescing, and status/event publication.

Current implementation spreads first three stages across `packages/core/src/session/runner/llm.ts:178-230`. Smallest boundary is a private `TurnSnapshot` assembly block/function in runner module. No new public `SessionExecutionContext` service yet.

## 2. Runner Input Contract

Public runner input remains `{ sessionID, force }` at `packages/core/src/session/runner/index.ts:19-28`.

Private provider-turn snapshot fields:

| Field                                              | Classification                  | Source / rule                                                                                       |
| -------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sessionID`                                        | immutable, durable              | `SessionSchema.ID`; session identity                                                                |
| location identity                                  | immutable, durable              | Session location; validate before assembly at `llm.ts:184-186`                                      |
| selected agent and agent settings                  | immutable, derived, per-turn    | `AgentV2.Service.select` at `llm.ts:187`; resample next turn only                                   |
| resolved model/provider/variant                    | immutable, derived, per-turn    | `SessionRunnerModel.resolve` at `llm.ts:204`, implementation `runner/model.ts:181-218`              |
| effective permission policy reference              | immutable for turn, derived     | `PermissionV2` configured rules at `permission.ts:137-161`; approval requests retain agent identity |
| Context Epoch baseline and sequence                | immutable, durable              | `SessionContextEpoch.initialize/prepare`, `context-epoch.ts:23-77`                                  |
| projected history                                  | immutable request input         | `SessionHistory.entriesForRunner` at `llm.ts:204-206`                                               |
| capability definitions and registration identities | immutable request input         | `ToolRegistry.materialize` at `llm.ts:207-209`, registry `tool/registry.ts:106-121`                 |
| provider options/auth-resolved connection          | immutable for attempt           | resolved before `LLM.request`; no registry reread during stream                                     |
| promotion result                                   | immutable snapshot input        | `SessionInput.promoteSteers/promoteNextQueued`, `llm.ts:192-200`                                    |
| request headers/cache key                          | derived, immutable              | `llm.ts:210-229`                                                                                    |
| `step`, `needsContinuation`                        | mutable drain state             | `llm.ts:190-191,443-453`; not part of provider request after snapshot                               |
| tool fibers/publisher state                        | mutable attempt state, volatile | `llm.ts:189,234-246,313`                                                                            |
| pending steer/queue rows                           | durable mutable inbox           | `SessionInput`; changed only at promotion boundaries                                                |
| live busy/idle status                              | volatile event state            | `llm.ts:425-465`; no durable rows                                                                   |

## 3. Context Assembly

| Input                      | Resolver                                                      | Exact source                                                                    |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Session/location           | `SessionStore`                                                | `packages/core/src/session/runner/llm.ts:115-123,184-186`                       |
| Agent                      | `AgentV2.Service`                                             | `llm.ts:187`; `packages/core/src/agent.ts:35-43`                                |
| Model/provider             | `SessionRunnerModel` → Catalog/Integration                    | `llm.ts:204`; `packages/core/src/session/runner/model.ts:181-218`               |
| System sources             | `SystemContextRegistry`, `SkillGuidance`, `ReferenceGuidance` | `llm.ts:173-176`; registry `packages/core/src/system-context/registry.ts:12-44` |
| Epoch baseline             | `SessionContextEpoch`                                         | `llm.ts:188,202-205`; `packages/core/src/session/context-epoch.ts:40-77`        |
| History                    | `SessionHistory`                                              | `llm.ts:204-206`                                                                |
| Tools/capabilities         | `ToolRegistry`                                                | `llm.ts:207-209`; `packages/core/src/tool/registry.ts:42-123`                   |
| Permission policy/approval | `PermissionV2`                                                | `packages/core/src/permission.ts:137-218`                                       |
| Delivery state             | `SessionInput` + coordinator                                  | `packages/core/src/session/input.ts:41-81`; `run-coordinator.ts:67-103`         |
| Metadata/events            | `EventV2`, publisher, Session events                          | `llm.ts:234-246,367-387`                                                        |
| Diagnostics                | no V2 resolver currently                                      | V1 formatter only: `packages/opencode/src/lsp/diagnostic.ts:20-27`              |

Discovery must happen before snapshot freeze. Mutable registries may change after freeze; current turn continues with captured definitions and identities. Next turn re-resolves.

## 4. Runner Responsibilities

- Validate Session location before turn.
- Promote admitted steer/queue input at safe boundaries.
- Prepare or reuse Context Epoch baseline.
- Capture projected history and immutable turn inputs.
- Build one provider request and call one `llm.stream(request)`.
- Persist streamed text, reasoning, usage, errors, tool calls, and results.
- Settle local tools through `ToolRegistry`.
- Apply doom-loop permission through `PermissionV2`.
- Handle provider failure, compaction transition, interruption, stale tool calls, and continuation.
- Publish ephemeral busy/idle status.

## 5. Runner Non-Responsibilities

- Config file discovery/parsing: `packages/core/src/config.ts:128-154`.
- Agent registration/config loading.
- Provider SDK loading, credential acquisition, and catalog population.
- MCP transport, auth, client lifecycle, resource/prompt lifecycle.
- LSP process/client lifecycle and diagnostic collection.
- Tool registration lifecycle and policy evaluation.
- Durable prompt admission, identity conflict handling, and projection.
- Cross-session coordination or remote ownership.
- Durable Context Epoch storage internals.

## 6. MCP Boundary

### Tool lifecycle

```text
MCP lifecycle
  → discovery
  → V2 MCP capability adapter
  → scoped ToolRegistry registration
  → ToolRegistry materialization
  → immutable TurnSnapshot
  → Runner
```

MCP lifecycle must live in a location-scoped integration layer outside Runner. The missing boundary is a V2 MCP adapter that converts discovered MCP tools into `ToolRegistry.register` capabilities with Scope cleanup. `ToolRegistry` already owns scoped overlays, materialization, identity capture, stale rejection, and settlement (`packages/core/src/tool/registry.ts:42-123`; `specs/v2/tools.md:135-180`).

Runner must not import V1 `MCP.Service`. V1 MCP owns transport/client state and broader resource APIs (`packages/opencode/src/mcp/index.ts:142-184`).

### Instruction lifecycle

```text
MCP instructions
  → V2 SystemContext source adapter
  → SystemContextRegistry
  → Context Epoch safe-boundary admission
  → immutable TurnSnapshot
  → Runner
```

MCP instruction adapter must use stable source key, codec, unavailable/removal semantics, and Scope cleanup. Registry is generic today; it does not itself discover MCP (`packages/core/src/system-context/registry.ts:7-44`).

## 7. Permission Boundary

`PermissionV2` resolves agent rules plus saved project approvals and owns ask/assert/reply/pending lifecycle (`packages/core/src/permission.ts:137-218`).

- At snapshot assembly, effective agent/session policy is selected for tool materialization.
- Tool definitions wholly denied by policy are omitted by current `ToolRegistry` behavior (`tool/registry.ts:106-120`).
- Sensitive/trusted tool execution calls `PermissionV2.assert` during settlement.
- Approval identity captures Session, agent, assistant message, and call ID. Later agent changes cannot alter current call policy.
- Runner passes identity and consumes result; it does not evaluate rules.

Policy may be re-resolved for next provider turn. It must not be re-resolved during one provider stream or used to reinterpret an already advertised call.

## 8. Diagnostics Boundary

Diagnostics are **volatile observations**, not durable semantic context by default. They describe current workspace/LSP state and can change without a Session semantic event. Persisting every diagnostic change in Context Epoch would create noisy, stale, and replay-sensitive context updates.

Preferred initial boundary:

```text
location-scoped LSP diagnostic collector
  → volatile diagnostic observation/event
  → per-turn diagnostic snapshot, if model visibility requested
  → TurnSnapshot request context (not Context Epoch baseline)
```

The existing pure formatter may be reused (`packages/opencode/src/lsp/diagnostic.ts:20-27`), but collector and lifecycle remain outside Runner. No V2 diagnostic producer exists today.

If diagnostics must become model-visible, use a separate per-turn observation field or explicit request-context mechanism. Do not register volatile diagnostics as ordinary `SystemContext`; this prevents changes from becoming durable epoch state. A future durable diagnostic source would need stable identity, unavailable/removal semantics, coalescing, and explicit retention policy.

## 9. Context Epoch Contract

### Invariant

One Session has one active Context Epoch. Epoch owns one immutable baseline text, baseline sequence, and durable source snapshot. Every provider request uses exactly one captured baseline from that epoch. Context changes are observed and admitted only at safe provider-turn boundaries. Baseline replacement occurs only after compaction or an explicitly designed epoch transition. This is a target invariant; current inline assembly has no standalone `TurnSnapshot` object.

### Lifecycle

- **Creation:** `initialize` observes registry sources and inserts baseline/snapshot before first promotion where required (`context-epoch.ts:23-29`; `CONTEXT.md:105-113`).
- **Capture:** `prepare` returns baseline and sequence for current turn (`context-epoch.ts:40-77`).
- **Validation:** runner checks Session location before turn assembly (`llm.ts:184-186`); current source does not perform a second check immediately before provider request.
- **Continuation:** next turn reloads history, re-samples permitted mutable context, and prepares/reuses epoch (`llm.ts:397-453`).
- **Move:** Session location event causes destination resolution; move/epoch reset semantics are defined in `CONTEXT.md:117-134`.
- **Interruption:** current provider stream and tool fibers stop; pending durable steer/queue inputs remain for later wake; unsettled tools fail (`llm.ts:337-357`).

### Epoch N versus N+1

If a prepared snapshot belongs to epoch N but a future execution path observes Session epoch N+1 before request, discard snapshot and reassemble. Never send N context with N+1 history/location. Current local runner serialization prevents this within one Session coordinator, but current source has no explicit second pre-request epoch/location check; this remains a contract requirement for any path that can escape coordinator serialization.

### CAS/generation decision

No additional CAS is required for current process-local execution because `SessionRunCoordinator` serializes one Session (`packages/core/src/session/run-coordinator.ts:67-103`) and runner is reached through `SessionExecutionLocal` (`packages/core/src/session/execution/local.ts:14-27`).

CAS/generation fencing becomes required before multi-process execution, remote placement, or any independent Context Epoch writer. Current `context-epoch.ts:46-69,141-173` reads then writes without expected baseline generation. Required future predicate: Session ID plus expected epoch/baseline sequence; zero-row update retries/discards stale preparation.

### Race scenarios

1. **Two independent epoch writers:** both read baseline sequence 10; writer A publishes update and advances; writer B publishes from stale snapshot and overwrites. Local coordinator prevents this today; clustered writers need CAS.
2. **Move during preparation:** runner captures source location/epoch, Session moves, then request starts. Location check must run immediately before snapshot/request and stale execution must interrupt; destination reassembles after wake.
3. **Capability replacement during stream:** MCP adapter replaces tool registration after snapshot. Current registration identity causes settlement to return stale-call error rather than invoking replacement (`tool/registry.ts:106-121`).

## 10. V1 Compatibility

- **Reuse pure provider prompt semantics:** safe because `packages/core/src/session/system.ts:15-45` contains model-family mapping without V1 service ownership. Do not import V1 `Provider.Service` or V1 prompt orchestration.
- **Reuse pure diagnostic formatter:** safe as formatting logic only. Do not import V1 LSP lifecycle or make formatter owner of observation state.
- **Use V1 behavior/tests as parity reference:** safe for migration evidence. Do not copy `SessionPrompt` ownership.

Remain outside V2:

- `SessionPrompt.Service` and `SessionPrompt.loop`.
- V1 `SessionTools.resolve` and processor/EffectBridge ownership.
- V1 `MCP.Service` as Runner dependency.
- V1 provider service for model resolution.
- V1 LSP runtime/client lifecycle.

V1 HTTP prompt routes continue using V1 while V2 routes use `SessionV2`/`SessionExecution`: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:295-327` and `server.ts:299-303`.

## 11. Implementation Boundary

| File                                           | Symbol                               | Intended change                                                                                        | Dependencies                                                | Tests                                                               | Class                               |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `packages/core/src/session/runner/llm.ts`      | `runTurnAttempt`                     | Extract private snapshot assembly; freeze values before request; keep orchestration below boundary     | Existing Agent/Model/Epoch/History/Tool/Permission services | `packages/core/test/session-runner.test.ts` request/turn assertions | B: component boundary               |
| `packages/core/src/session/runner/index.ts`    | `SessionRunner.Interface`            | Documentation/type only if private helper needs named contract; public input unchanged                 | Runner module                                               | compile/type tests                                                  | A: local implementation             |
| `packages/core/src/system-context/registry.ts` | `Service.register/load`              | No structural change initially; adapters register sources                                              | Scope, SystemContext                                        | registry ordering/cleanup tests                                     | A: existing boundary                |
| V2 location/MCP integration seam               | to identify before coding            | Add MCP lifecycle adapter, scoped tool registration, instruction source registration                   | MCP client/config/auth, ToolRegistry, SystemContextRegistry | new MCP runner integration tests                                    | C: architectural change             |
| `packages/core/src/tool/registry.ts`           | `Service.register/materialize`       | Preserve identity/settlement; extend only if MCP adapter needs existing registration contract gap      | Scope, PermissionV2                                         | stale/denied/cleanup tests                                          | B: component boundary               |
| V2 LSP/location integration seam               | to identify before coding            | Add volatile diagnostic collector/observation boundary                                                 | LSP, Location, SystemContext or request observation         | new diagnostics tests                                               | C: architectural change             |
| `packages/core/src/session/context-epoch.ts`   | `initialize/prepare/advance/replace` | Add CAS only when writer can escape coordinator; no immediate change justified                         | DB, EventV2, Session history                                | concurrent prepare/restart tests                                    | C: conditional architectural change |
| `packages/core/src/session/runner/llm.ts`      | `run`, interruption paths            | Preserve stale-location check and unsettled-tool failure; no behavior change in context contract slice | Location, ToolRegistry, EventV2                             | move/interruption tests                                             | A: existing implementation          |

Existing V1 files are references, not initial change targets.

## 12. Implementation Order

1. Add private snapshot boundary and assertions without changing behavior.
2. Add/verify Context Epoch lifecycle and restart tests; confirm coordinator is sole current writer.
3. Define MCP lifecycle adapter placement and layer ordering before implementing tool parity.
4. Implement MCP tool registration/materialization, then MCP instruction source.
5. Define volatile diagnostics collector/observation contract and tests.
6. Add diagnostics model visibility only if requested, without durable epoch by default.
7. Run V1 parity and V2 concurrency gates.
8. Consider route migration only after boundaries are proven.

## 13. Verification Matrix

| Change           | Unit                                     | Integration/race                                         | V1 regression                          | V2 behavior                      | D2                 |
| ---------------- | ---------------------------------------- | -------------------------------------------------------- | -------------------------------------- | -------------------------------- | ------------------ |
| Turn snapshot    | snapshot construction, freeze/call count | model/tool registry mutation during stream               | provider/system prompt parity          | exact request inputs             | runner flow        |
| Epoch            | initialize/prepare/reconcile/replace     | restart, compaction, concurrent writer if enabled        | instruction/context parity             | safe-boundary admission          | epoch edge         |
| MCP tools        | adapter registration/filtering           | disconnect, scope close, stale replacement, continuation | `packages/opencode/test/mcp/*.test.ts` | request definitions + settlement | MCP edges          |
| MCP instructions | source codec/render/remove               | server unavailable/reconnect                             | V1 system MCP tests                    | baseline/update behavior         | MCP → context      |
| Permissions      | rules/approval identity                  | interruption/reply races                                 | V1 permission behavior where present   | denied/ask/allow                 | permission edge    |
| Diagnostics      | formatter/source unavailable/removal     | location move, changing diagnostics                      | existing LSP/prompt tests              | observation visibility           | diagnostics edge   |
| Continuation     | steer/queue promotion                    | coalescing, interruption, concurrent Sessions            | V1 prompt behavior                     | existing runner tests            | continuation state |

Existing coverage includes SystemContext/registry, coordinator, ToolRegistry, permissions, runner, and move tests. Missing coverage includes V2 MCP runner integration, V2 diagnostic production, Context Epoch lifecycle/restart/CAS, and move-while-running. References: `packages/core/test/system-context/registry.test.ts:23-111`, `session-run-coordinator.test.ts:8`, `session-runner-tool-registry.test.ts:61-115`, `permission.test.ts:105`, `move-session.test.ts:53`, `session-runner.test.ts:1914-2289,3777-3880`.

## 14. Explicit Non-Goals

- No code implementation in this contract task.
- No public `SessionExecutionContext` service.
- No reintroduction of `SessionPrompt.loop`.
- No V1 service wholesale migration.
- No MCP transport rewrite or plugin architecture rewrite.
- No diagnostics persistence in Context Epoch by default.
- No doom-loop threshold change.
- No steer/queue vocabulary or coordinator behavior change.
- No durable status/recovery redesign.
- No package/config/dependency/API changes.

## 15. Final Architecture

```text
OpenCode
├── V1
│   └── SessionPrompt
│       ├── V1 provider/tools/MCP/diagnostics
│       └── legacy prompt loop
│
└── V2
    ├── SessionExecution
    │   └── SessionRunCoordinator
    ├── Context Assembly
    │   ├── AgentV2
    │   ├── SessionRunnerModel
    │   ├── PermissionV2
    │   ├── ToolRegistry
    │   ├── SystemContextRegistry
    │   └── Context Epoch
    ├── Turn Snapshot (private target boundary)
    ├── Runner
    ├── Continuation / Events
    ├── ToolRegistry
    ├── SystemContextRegistry
    ├── PermissionV2
    └── Context Epoch

MCP lifecycle
  → V2 MCP adapter
  → ToolRegistry capabilities
  → Turn Snapshot → Runner

MCP instructions
  → SystemContext source
  → SystemContextRegistry
  → Context Epoch / safe boundary
  → Turn Snapshot → Runner

LSP diagnostic collector
  → volatile diagnostic observation
  → optional per-turn request context
  → Turn Snapshot → Runner
```
