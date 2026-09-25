---
type: "knowledge"
name: "architecture"
source_paths: ["packages/core/src/session.ts","packages/core/src/session","packages/core/src/system-context","packages/server/src/handlers/session.ts","packages/protocol/src","packages/schema/src"]
related: ["integrations","security","workflows"]
last_verified_commit: "4eefbb450e81e49a41dd7cc14a9e1285db0ef7c3"
source_digest: "62d4f06c236a9855816a4a54b33663ed18dadf32ba92840bdffd2f09c551ff7a"
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
