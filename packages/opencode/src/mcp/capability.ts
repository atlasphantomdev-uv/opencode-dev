export * as McpCapability from "./capability"

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { EventV2 } from "@opencode-ai/core/event"
import { McpV2 } from "@opencode-ai/core/mcp"
import { Tool } from "@opencode-ai/core/tool/tool"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Stream } from "effect"
import { MCP } from "@/mcp"
import { InstanceStore } from "@/project/instance-store"
import {
  MAX_MCP_RESOURCE_BLOB_BYTES,
  SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES,
  base64Size,
  formatBytes,
} from "@/session/tools"
import { McpCatalog } from "./catalog"

/**
 * V2 Model Context Protocol host.
 *
 * Core declares the `McpV2` capability and a `McpV2.hostNode` placeholder inside the Location tree;
 * this layer is what its hosts replace that placeholder with, so Core never imports this package's
 * MCP runtime. Each call maps the Location directory onto the instance context that the v1 MCP
 * runtime already keys its clients by, so V2 reuses those clients instead of opening a second set.
 * The layer takes its services from the application graph because the Location tree cannot: the
 * instance store is global, and hoisting it would rebuild it per Location.
 */
const toContent = (output: unknown): ReadonlyArray<Tool.Content> => {
  // Boundary assertion: `McpCatalog.call` already validated this payload with `CallToolResultSchema`,
  // and the dynamic tool mode types tool output as `unknown` by design.
  const result = output as CallToolResult
  const parts: Array<Tool.Content> = []
  for (const item of result.content) {
    if (item.type === "text") {
      parts.push({ type: "text", text: item.text })
      continue
    }
    if (item.type === "image") {
      parts.push({ type: "file", data: item.data, mime: item.mimeType })
      continue
    }
    if (item.type !== "resource") continue
    const resource = item.resource
    if ("text" in resource && resource.text !== undefined) parts.push({ type: "text", text: resource.text })
    if (!("blob" in resource) || resource.blob === undefined) continue
    const mime = resource.mimeType ?? "application/octet-stream"
    const size = base64Size(resource.blob)
    if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
      parts.push({
        type: "text",
        text: `[Binary MCP resource omitted: ${resource.uri} (${mime}, ${formatBytes(size)}) is not a supported attachment type]`,
      })
      continue
    }
    if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
      parts.push({
        type: "text",
        text: `[Binary MCP resource omitted: ${resource.uri} (${mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
      })
      continue
    }
    parts.push({ type: "file", data: resource.blob, mime, name: resource.uri })
  }
  return parts
}

export const layer = Layer.effect(
  McpV2.Host,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const instances = yield* InstanceStore.Service
    const mcp = yield* MCP.Service

    const inInstance = <A, E, R>(directory: AbsolutePath, effect: Effect.Effect<A, E, R>) =>
      instances.provide({ directory }, effect)

    return McpV2.Host.of({
      servers: Effect.fn("McpCapability.servers")(function* (directory) {
        return (yield* inInstance(directory, mcp.instructions())).map((server) => ({
          name: server.name,
          instructions: server.instructions,
          tools: server.tools,
        }))
      }),
      tools: Effect.fn("McpCapability.tools")(function* (directory) {
        const advertised: Array<McpV2.AdvertisedTool> = []
        for (const [name, entry] of Object.entries(yield* inInstance(directory, mcp.tools()))) {
          advertised.push({
            name,
            description: entry.def.description ?? "",
            jsonSchema: { ...McpCatalog.inputSchema(entry.def) },
            execute: (input) =>
              Effect.tryPromise({
                try: () => McpCatalog.call(entry.client, entry.def, entry.timeout, input),
                catch: (error) =>
                  new ToolFailure({
                    message: error instanceof Error ? error.message : String(error),
                    error,
                  }),
              }).pipe(Effect.map(toContent)),
          })
        }
        return advertised
      }),
      // Tool sets change while a server connects, disconnects, or advertises a new list.
      changed: () => events.subscribe(McpEvent.ToolsChanged).pipe(Stream.map(() => undefined)),
    })
  }),
)
