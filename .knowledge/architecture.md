---
type: "knowledge"
name: "architecture"
source_paths: ["packages/core/src/session.ts","packages/core/src/session","packages/core/src/system-context","packages/server/src/handlers/session.ts","packages/protocol/src","packages/schema/src"]
related: ["integrations","security","workflows"]
last_verified_commit: "79dda345bc51a3cb94b226fef0156684650852c6"
source_digest: "b9e63a3a9e78f8a6be3e35b6646cdb1bc2a85fa0ba741ca2fbbd227a60593361"
---

# architecture

## Navigation notes

V2: Protocol API → Server handlers → Core SessionV2 → durable SessionInput → SessionExecution/coordinator → Location-scoped runner → LLM. Schema owns shared shapes. Client runtime depends on Schema/Protocol; sdk-next composes Client/Core/Server. Session history and context epochs remain Session-owned. Inspect specs/v2 and existing docs/architecture maps when available. V1 compatibility must be established from executable source and tests; these notes do not assert parity.

These curated notes are review guidance, not automatically verified behavioral claims.

## Source of truth

- `packages/core/src/session.ts`
- `packages/core/src/session`
- `packages/core/src/system-context`
- `packages/server/src/handlers/session.ts`
- `packages/protocol/src`
- `packages/schema/src`
