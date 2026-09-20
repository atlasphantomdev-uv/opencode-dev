---
type: "knowledge"
name: "integrations"
source_paths: ["packages/llm/src","packages/opencode/src/mcp","packages/opencode/src/mcp/index.ts","packages/opencode/src/cli/cmd/mcp.ts","packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts","packages/opencode/src/lsp","packages/core/src/tool","packages/core/src/plugin","packages/core/src/integration.ts","packages/plugin"]
related: ["architecture","security"]
last_verified_commit: "992242f7af4a30ae91404cc8485021392e8ea572"
source_digest: "cff2179662a784fb28bc521f6b5b866d303c3e1c45d19480eb2f166982f75bf7"
---

# integrations

## Navigation notes

LLM provides provider/protocol adapters. Legacy opencode owns MCP transport/auth/lifecycle and LSP diagnostics. Core owns the V2 tool registry and integration/plugin services. Do not infer a V2 MCP or diagnostics bridge from the legacy implementation. Inspect runner tool materialization before changing integration behavior. MCP registration: `packages/opencode/src/cli/cmd/mcp.ts` (`addMcpToConfig`) writes named config entries; `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts` delegates runtime registration to `MCP.add`. Initialization: `packages/opencode/src/mcp/index.ts` (`InstanceState.make`) reads cfg.mcp and creates clients; `MCP.add` creates/stores runtime clients.

These curated notes are review guidance, not automatically verified behavioral claims.

## Source of truth

- `packages/llm/src`
- `packages/opencode/src/mcp`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/cli/cmd/mcp.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
- `packages/opencode/src/lsp`
- `packages/core/src/tool`
- `packages/core/src/plugin`
- `packages/core/src/integration.ts`
- `packages/plugin`
