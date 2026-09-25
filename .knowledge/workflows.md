---
type: "knowledge"
name: "workflows"
source_paths: ["AGENTS.md",".github/workflows",".husky","script","specs/v2","packages/client/script","packages/sdk/js/script","packages/opencode/src/index.ts","packages/app/src/entry.tsx","packages/desktop/src/main/index.ts"]
related: ["architecture","configuration"]
last_verified_commit: "4eefbb450e81e49a41dd7cc14a9e1285db0ef7c3"
source_digest: "395b3d791428c8869e2547fcf3f357b04a9a9f19f9273707cbf1edae7de86749"
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
