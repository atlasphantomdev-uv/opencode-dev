---
type: "knowledge"
name: "workflows"
source_paths: ["AGENTS.md",".github/workflows",".husky","script","specs/v2","packages/client/script","packages/sdk/js/script","packages/opencode/src/index.ts","packages/app/src/entry.tsx","packages/desktop/src/main/index.ts"]
related: ["architecture","configuration"]
last_verified_commit: "992242f7af4a30ae91404cc8485021392e8ea572"
source_digest: "58c62cdebd56e1d0eb4ea44132ae3a3302731fc03416c1949be0abff5cc8ff5b"
---

# workflows

## Navigation notes

Entry points: CLI: packages/opencode/src/index.ts (yargs); Web: packages/app/src/entry.tsx (Solid/Vite); Desktop: packages/desktop/src/main/index.ts (Electron). CI runs Turbo unit tests, app Playwright tests, generated-client checks and typechecks. Run tests in the affected package; root test intentionally fails. Public API changes require client generation and SDK workflow. Husky pre-push checks Bun and typechecks. Agent context starts at the index, then focused documents and authoritative source.

These curated notes are review guidance, not automatically verified behavioral claims.

## Source of truth

- `AGENTS.md`
- `.github/workflows`
- `.husky`
- `script`
- `specs/v2`
- `packages/client/script`
- `packages/sdk/js/script`
- `packages/opencode/src/index.ts`
- `packages/app/src/entry.tsx`
- `packages/desktop/src/main/index.ts`
