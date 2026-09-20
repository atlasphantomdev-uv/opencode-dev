---
type: "knowledge"
name: "architecture"
source_paths: ["packages/core/src/session.ts","packages/core/src/session","packages/core/src/system-context","packages/server/src/handlers/session.ts","packages/protocol/src","packages/schema/src"]
related: ["integrations","security","workflows"]
last_verified_commit: "992242f7af4a30ae91404cc8485021392e8ea572"
source_digest: "5e79b7ed9f4791cacde4ea709db6c112a5f89296f02b4dcee991b2ed66cfa8ee"
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
