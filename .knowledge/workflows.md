---
type: "knowledge"
name: "workflows"
source_paths: ["AGENTS.md",".github/workflows",".husky","script","specs/v2","packages/client/script","packages/sdk/js/script","packages/opencode/src/index.ts","packages/app/src/entry.tsx","packages/desktop/src/main/index.ts"]
related: ["architecture","configuration"]
last_verified_commit: "eef36e3bfba5342598a380ad5af045ecfac2389a"
source_digest: "3e48f6927f5cbe81ded5323edf56069ab7a415c7f657bc258fdfe8925a53987a"
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
