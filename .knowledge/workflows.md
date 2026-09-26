---
type: "knowledge"
name: "workflows"
source_paths: ["AGENTS.md",".github/workflows",".husky","script","specs/v2","packages/client/script","packages/sdk/js/script","packages/opencode/src/index.ts","packages/app/src/entry.tsx","packages/desktop/src/main/index.ts"]
related: ["architecture","configuration"]
last_verified_commit: "79dda345bc51a3cb94b226fef0156684650852c6"
source_digest: "8429f7fea5842b1a1ad907934ae9f49ff3315e905ef83ac0e101e7ac18d63f54"
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
