export const entrypoints = [
  { name: "CLI", path: "packages/opencode/src/index.ts", runtime: "yargs" },
  { name: "Web", path: "packages/app/src/entry.tsx", runtime: "Solid/Vite" },
  { name: "Desktop", path: "packages/desktop/src/main/index.ts", runtime: "Electron" },
]

export const topics = [
  {
    id: "architecture",
    paths: [
      "packages/core/src/session.ts",
      "packages/core/src/session",
      "packages/core/src/system-context",
      "packages/server/src/handlers/session.ts",
      "packages/protocol/src",
      "packages/schema/src",
    ],
    related: ["integrations", "security", "workflows"],
    notes:
      "V2: Protocol API → Server handlers → Core SessionV2 → durable SessionInput → SessionExecution/coordinator → Location-scoped runner → LLM. Schema owns shared shapes. Client runtime depends on Schema/Protocol; sdk-next composes Client/Core/Server. Session history and context epochs remain Session-owned. Inspect specs/v2 and existing docs/architecture maps when available. V1 compatibility must be established from executable source and tests; these notes do not assert parity.",
  },
  {
    id: "integrations",
    paths: [
      "packages/llm/src",
      "packages/opencode/src/mcp",
      "packages/opencode/src/mcp/index.ts",
      "packages/opencode/src/cli/cmd/mcp.ts",
      "packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts",
      "packages/opencode/src/lsp",
      "packages/core/src/mcp.ts",
      "packages/core/src/lsp.ts",
      "packages/core/src/tool",
      "packages/core/src/plugin",
      "packages/core/src/integration.ts",
      "packages/plugin",
    ],
    related: ["architecture", "security"],
    notes:
      "LLM provides provider/protocol adapters. Legacy opencode owns MCP transport/auth/lifecycle and LSP diagnostics. Core owns the V2 tool registry and integration/plugin services. Core declares the V2 capability seams `McpV2` (`packages/core/src/mcp.ts`) and `LspV2` (`packages/core/src/lsp.ts`) with no-op default host nodes; `AppNodeBuilderV1.hostReplacements` (`packages/opencode/src/effect/app-node-builder-v1.ts`) binds those Location-tree placeholders to the V1-backed host layers (`packages/opencode/src/mcp/capability.ts`, `packages/opencode/src/lsp/capability.ts`), and the routes apply the same list when `buildLocationServiceMap` compiles the Location tree. Hosts are layers rather than nodes because the instance store is global: the Location map hoists globals, which would rebuild the store and rerun the instance bootstrap per Location. `McpV2.toolsNode` registers advertised MCP tools as scoped canonical registrations and refreshes them on `mcp.tools.changed`; the runner composes MCP server instructions into system context and the V2 edit/write/apply_patch leaves append LSP blocks to their model output. The embedded `packages/server` and `packages/sdk-next` deliberately ship the default no-op capabilities. Inspect runner tool materialization before changing integration behavior. MCP registration: `packages/opencode/src/cli/cmd/mcp.ts` (`addMcpToConfig`) writes named config entries; `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts` delegates runtime registration to `MCP.add`. Initialization: `packages/opencode/src/mcp/index.ts` (`InstanceState.make`) reads cfg.mcp and creates clients; `MCP.add` creates/stores runtime clients.",
  },
  {
    id: "security",
    paths: [
      "packages/server/src/auth.ts",
      "packages/server/src/middleware",
      "packages/core/src/permission.ts",
      "packages/core/src/permission",
      "packages/core/src/credential.ts",
      "packages/core/src/credential",
      "packages/core/src/filesystem",
      "packages/core/src/database",
      "packages/core/src/session/sql.ts",
    ],
    related: ["architecture", "configuration"],
    notes:
      "ServerAuth handles optional HTTP Basic credentials; middleware determines enforcement. Core permission policy/approval, credential services, filesystem boundaries, and tool execution are security-sensitive. V2 persistence uses Drizzle/SQLite with migrations; Session tables and projections own durable state. Never copy credential values or local configuration into knowledge.",
  },
  {
    id: "configuration",
    paths: [
      "package.json",
      "bun.lock",
      "turbo.json",
      "sst.config.ts",
      "infra",
      "packages/core/src/config.ts",
      "packages/core/src/config",
      "packages/core/src/flag",
      "packages/opencode/src/config",
      "packages/opencode/src/config/config.ts",
      "packages/opencode/src/provider/provider.ts",
      "packages/core/src/config/plugin/provider.ts",
      "packages/core/src/plugin/internal.ts",
    ],
    related: ["security", "workflows"],
    notes:
      "Root package.json owns Bun workspace/catalog versions and commands. Turbo coordinates package tasks. SST/infra define deployment resources. Core and legacy opencode have distinct configuration paths during migration. V2 provider/model flow: `packages/core/src/config.ts` → `packages/core/src/config/plugin/provider.ts` (`ConfigProviderPlugin` consumes Config.entries and transforms integrations/catalog). `packages/core/src/plugin/internal.ts` registers this consumer after provider/external plugins. Legacy flow: `packages/opencode/src/config/config.ts` → `packages/opencode/src/provider/provider.ts` (`config.get`, cfg.provider and cfg.model). Read schemas/loaders for supported settings; knowledge never stores environment or secret values.",
  },
  {
    id: "workflows",
    paths: [
      "AGENTS.md",
      ".github/workflows",
      ".husky",
      "script",
      "specs/v2",
      "packages/client/script",
      "packages/sdk/js/script",
      ...entrypoints.map((entry) => entry.path),
    ],
    related: ["architecture", "configuration"],
    notes: `Entry points: ${entrypoints.map((entry) => `${entry.name}: ${entry.path} (${entry.runtime})`).join("; ")}. CI runs Turbo unit tests, app Playwright tests, generated-client checks and typechecks. Run tests in the affected package; root test intentionally fails. Public API changes require client generation and SDK workflow. Husky pre-push checks Bun and typechecks. Agent context starts at the index, then focused documents and authoritative source.`,
  },
]
