---
type: "knowledge"
name: "architecture"
source_paths: ["packages/core/src/session.ts","packages/core/src/session","packages/core/src/system-context","packages/server/src/handlers/session.ts","packages/protocol/src","packages/schema/src"]
related: ["integrations","security","workflows"]
last_verified_commit: "eef36e3bfba5342598a380ad5af045ecfac2389a"
source_digest: "46cf272dd950d6415ab51038b137354ecd1aef14dcb24403b7ecffbddebd1c36"
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
