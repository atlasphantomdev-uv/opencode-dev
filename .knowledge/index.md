---
type: "knowledge"
name: "index"
source_paths: ["package.json","packages/opencode/src/index.ts","packages/app/src/entry.tsx","packages/desktop/src/main/index.ts"]
related: ["architecture","integrations","security","configuration","workflows","module-github","module-packages-app","module-packages-cli","module-packages-client","module-packages-codemode","module-packages-console-app","module-packages-console-core","module-packages-console-function","module-packages-console-mail","module-packages-console-resource","module-packages-console-support","module-packages-core","module-packages-desktop","module-packages-effect-drizzle-sqlite","module-packages-effect-sqlite-node","module-packages-enterprise","module-packages-function","module-packages-http-recorder","module-packages-httpapi-codegen","module-packages-llm","module-packages-opencode","module-packages-plugin","module-packages-protocol","module-packages-schema","module-packages-script","module-packages-sdk-next","module-packages-sdk-js","module-packages-server","module-packages-session-ui","module-packages-slack","module-packages-stats-app","module-packages-stats-core","module-packages-stats-server","module-packages-storybook","module-packages-tui","module-packages-ui","module-packages-web","module-sdks-vscode"]
last_verified_commit: "4eefbb450e81e49a41dd7cc14a9e1285db0ef7c3"
source_digest: "796c71e9caee064c85dd3f19906acb89997f9b3b481c8ae552da58b9d4a3582a"
---

# OpenCode repository knowledge

AI-powered development tool; Bun/TypeScript workspace undergoing V1 → V2 migration. Source and tests are authoritative. Read only the relevant focused document, then verify implementation-critical facts in source.

Start: CLI: `packages/opencode/src/index.ts`; Web: `packages/app/src/entry.tsx`; Desktop: `packages/desktop/src/main/index.ts`.

## Concerns

- [architecture](architecture.md)
- [integrations](integrations.md)
- [security](security.md)
- [configuration](configuration.md)
- [workflows](workflows.md)

## Packages

- [github](module-github.md)
- [packages/app](module-packages-app.md)
- [packages/cli](module-packages-cli.md)
- [packages/client](module-packages-client.md)
- [packages/codemode](module-packages-codemode.md)
- [packages/console/app](module-packages-console-app.md)
- [packages/console/core](module-packages-console-core.md)
- [packages/console/function](module-packages-console-function.md)
- [packages/console/mail](module-packages-console-mail.md)
- [packages/console/resource](module-packages-console-resource.md)
- [packages/console/support](module-packages-console-support.md)
- [packages/core](module-packages-core.md)
- [packages/desktop](module-packages-desktop.md)
- [packages/effect-drizzle-sqlite](module-packages-effect-drizzle-sqlite.md)
- [packages/effect-sqlite-node](module-packages-effect-sqlite-node.md)
- [packages/enterprise](module-packages-enterprise.md)
- [packages/function](module-packages-function.md)
- [packages/http-recorder](module-packages-http-recorder.md)
- [packages/httpapi-codegen](module-packages-httpapi-codegen.md)
- [packages/llm](module-packages-llm.md)
- [packages/opencode](module-packages-opencode.md)
- [packages/plugin](module-packages-plugin.md)
- [packages/protocol](module-packages-protocol.md)
- [packages/schema](module-packages-schema.md)
- [packages/script](module-packages-script.md)
- [packages/sdk-next](module-packages-sdk-next.md)
- [packages/sdk/js](module-packages-sdk-js.md)
- [packages/server](module-packages-server.md)
- [packages/session-ui](module-packages-session-ui.md)
- [packages/slack](module-packages-slack.md)
- [packages/stats/app](module-packages-stats-app.md)
- [packages/stats/core](module-packages-stats-core.md)
- [packages/stats/server](module-packages-stats-server.md)
- [packages/storybook](module-packages-storybook.md)
- [packages/tui](module-packages-tui.md)
- [packages/ui](module-packages-ui.md)
- [packages/web](module-packages-web.md)
- [sdks/vscode](module-sdks-vscode.md)

Maintenance: `bun knowledge:status`, `bun knowledge:update`, `bun knowledge:validate`. See [developer guide](../script/knowledge/README.md). Fingerprints verify source snapshots, not semantic correctness.
