---
type: "knowledge"
name: "workflows"
source_paths: ["AGENTS.md",".github/workflows",".husky","script","specs/v2","packages/client/script","packages/sdk/js/script","packages/opencode/src/index.ts","packages/app/src/entry.tsx","packages/desktop/src/main/index.ts"]
related: ["architecture","configuration"]
last_verified_commit: "719604ebd65e4cdfe479c5f36dd2dbd28c693406"
source_digest: "8f72a99c1ce91b60abe992e7e9922cd7cf89b32f4d6e0867e0e008ed19659a96"
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
