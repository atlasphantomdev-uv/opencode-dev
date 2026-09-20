---
type: "knowledge"
name: "security"
source_paths: ["packages/server/src/auth.ts","packages/server/src/middleware","packages/core/src/permission.ts","packages/core/src/permission","packages/core/src/credential.ts","packages/core/src/credential","packages/core/src/filesystem","packages/core/src/database","packages/core/src/session/sql.ts"]
related: ["architecture","configuration"]
last_verified_commit: "e9f3a1384a9f5dbcd006d589d40a6b9d58f4ea83"
source_digest: "ec5bea7bffc0b077c29011d6c71055a2782e7b87a06848b2e456e2ca641e02be"
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
