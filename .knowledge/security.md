---
type: "knowledge"
name: "security"
source_paths: ["packages/server/src/auth.ts","packages/server/src/middleware","packages/core/src/permission.ts","packages/core/src/permission","packages/core/src/credential.ts","packages/core/src/credential","packages/core/src/filesystem","packages/core/src/database","packages/core/src/session/sql.ts"]
related: ["architecture","configuration"]
last_verified_commit: "4eefbb450e81e49a41dd7cc14a9e1285db0ef7c3"
source_digest: "e3bd6b5adc1e3d99fa34a4aa630b5568b501f6b44c05dcec0eda16b43dd90dc2"
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
