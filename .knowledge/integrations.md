---
type: "knowledge"
name: "integrations"
source_paths: ["packages/llm/src","packages/opencode/src/mcp","packages/opencode/src/mcp/index.ts","packages/opencode/src/cli/cmd/mcp.ts","packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts","packages/opencode/src/lsp","packages/core/src/mcp.ts","packages/core/src/lsp.ts","packages/core/src/tool","packages/core/src/plugin","packages/core/src/integration.ts","packages/plugin"]
related: ["architecture","security"]
last_verified_commit: "eef36e3bfba5342598a380ad5af045ecfac2389a"
source_digest: "515e97a4ad4a3eed1cf398b8d630661d323953cb58296edc269a306674ee9b74"
---

# integrations

## Navigation notes

LLM provides provider/protocol adapters. Legacy opencode owns MCP transport/auth/lifecycle and LSP diagnostics. Core owns the V2 tool registry and integration/plugin services. Core declares the V2 capability seams `McpV2` (`packages/core/src/mcp.ts`) and `LspV2` (`packages/core/src/lsp.ts`) with no-op default host nodes; `AppNodeBuilderV1.hostReplacements` (`packages/opencode/src/effect/app-node-builder-v1.ts`) binds those Location-tree placeholders to the V1-backed host layers (`packages/opencode/src/mcp/capability.ts`, `packages/opencode/src/lsp/capability.ts`), and the routes apply the same list when `buildLocationServiceMap` compiles the Location tree. Hosts are layers rather than nodes because the instance store is global: the Location map hoists globals, which would rebuild the store and rerun the instance bootstrap per Location. `McpV2.toolsNode` registers advertised MCP tools as scoped canonical registrations and refreshes them on `mcp.tools.changed`; the runner composes MCP server instructions into system context and the V2 edit/write/apply_patch leaves append LSP blocks to their model output. The embedded `packages/server` and `packages/sdk-next` deliberately ship the default no-op capabilities. Inspect runner tool materialization before changing integration behavior. MCP registration: `packages/opencode/src/cli/cmd/mcp.ts` (`addMcpToConfig`) writes named config entries; `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts` delegates runtime registration to `MCP.add`. Initialization: `packages/opencode/src/mcp/index.ts` (`InstanceState.make`) reads cfg.mcp and creates clients; `MCP.add` creates/stores runtime clients.

These curated notes are review guidance, not automatically verified behavioral claims.

## Source of truth

- `packages/llm/src`
- `packages/opencode/src/mcp`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/cli/cmd/mcp.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
- `packages/opencode/src/lsp`
- `packages/core/src/mcp.ts`
- `packages/core/src/lsp.ts`
- `packages/core/src/tool`
- `packages/core/src/plugin`
- `packages/core/src/integration.ts`
- `packages/plugin`
