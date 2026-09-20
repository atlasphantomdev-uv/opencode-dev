---
type: "knowledge"
name: "security"
source_paths: ["packages/server/src/auth.ts","packages/server/src/middleware","packages/core/src/permission.ts","packages/core/src/permission","packages/core/src/credential.ts","packages/core/src/credential","packages/core/src/filesystem","packages/core/src/database","packages/core/src/session/sql.ts"]
related: ["architecture","configuration"]
last_verified_commit: "992242f7af4a30ae91404cc8485021392e8ea572"
source_digest: "8c93e40eec539a2dae254f6296fec747d1f06d98a25cc6fbd18198dd38b855e7"
---

# security

## Navigation notes

ServerAuth handles optional HTTP Basic credentials; middleware determines enforcement. Core permission policy/approval, credential services, filesystem boundaries, and tool execution are security-sensitive. V2 persistence uses Drizzle/SQLite with migrations; Session tables and projections own durable state. Never copy credential values or local configuration into knowledge.

These curated notes are review guidance, not automatically verified behavioral claims.

## Source of truth

- `packages/server/src/auth.ts`
- `packages/server/src/middleware`
- `packages/core/src/permission.ts`
- `packages/core/src/permission`
- `packages/core/src/credential.ts`
- `packages/core/src/credential`
- `packages/core/src/filesystem`
- `packages/core/src/database`
- `packages/core/src/session/sql.ts`
