---
type: "knowledge"
name: "architecture"
source_paths: ["packages/core/src/session.ts","packages/core/src/session","packages/core/src/system-context","packages/server/src/handlers/session.ts","packages/protocol/src","packages/schema/src"]
related: ["integrations","security","workflows"]
last_verified_commit: "e9f3a1384a9f5dbcd006d589d40a6b9d58f4ea83"
source_digest: "5d472c7c4b03ee0d941a6fdaa8833a99e5d7c4907a12c2be260c0bb61e66c53a"
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
