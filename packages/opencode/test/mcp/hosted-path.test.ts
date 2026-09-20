import { afterEach, describe, expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { McpV2 } from "@opencode-ai/core/mcp"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SystemContext } from "@opencode-ai/core/system-context"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect, Layer } from "effect"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)

/**
 * The graph the HTTP server builds: `AppNodeBuilderV1` carries the host replacements, so the
 * Location tree's unbound `McpV2.hostNode` placeholder resolves to the v1 MCP runtime behind the
 * capability layer instead of core's host, which advertises nothing.
 */
const app = AppNodeBuilderV1.build(
  LayerNode.group([
    InstanceStore.node,
    Project.node,
    Database.node,
    EventV2.node,
    MCP.node,
    LSP.node,
    CrossSpawnSpawner.node,
    SessionV2.node,
    McpV2.hostNode,
    LocationServiceMap.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [SessionExecution.node, SessionExecution.noopLayer],
  ],
)

const it = testEffect(app)

const ref = (directory: string) => Location.Ref.make({ directory: AbsolutePath.make(directory) })

const inLocation = <A, E, R>(directory: string, self: Effect.Effect<A, E, R>) =>
  self.pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(ref(directory))))

const configured = (url: string): Partial<ConfigV1.Info> => ({
  formatter: false,
  lsp: false,
  mcp: { hosted: { type: "remote", url, oauth: false } },
})

afterEach(async () => {
  await disposeAllInstances()
})

/** A real MCP server in-process: no network, no subprocess, and it records every call it serves. */
const hosted = Effect.acquireRelease(
  Effect.promise(async () => {
    const calls: Array<{ name: string; arguments: unknown }> = []
    const protocol = new Server(
      { name: "hosted", version: "1.0.0" },
      { capabilities: { tools: {} }, instructions: "Call the echo tool for hosted text." },
    )
    protocol.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: [
          {
            name: "echo",
            description: "Echo text through the hosted server",
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
      }),
    )
    protocol.setRequestHandler(CallToolRequestSchema, (request) => {
      calls.push({ name: request.params.name, arguments: request.params.arguments })
      const text = (request.params.arguments as { text?: string } | undefined)?.text ?? ""
      return Promise.resolve({ content: [{ type: "text", text: `hosted echo: ${text}` }] })
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    await protocol.connect(transport)
    const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
    return {
      calls,
      url: http.url.toString(),
      close: async () => {
        await http.stop(true)
        await protocol.close()
      },
    }
  }),
  (server) => Effect.promise(server.close),
)

describe("hosted MCP path", () => {
  it.live(
    "projects and runs a configured v1 MCP server's tool inside a V2 Location",
    () =>
      Effect.gen(function* () {
        const server = yield* hosted
        const directory = yield* tmpdirScoped({ config: configured(server.url) })
        const sessions = yield* SessionV2.Service
        const session = yield* sessions.create({ location: ref(directory) })

        const projected = yield* inLocation(
          directory,
          Effect.gen(function* () {
            const mcp = yield* McpV2.Service
            const registry = yield* ToolRegistry.Service
            const advertised = yield* mcp.tools()
            const instructions = yield* SystemContext.initialize(
              yield* mcp.instructions({ id: AgentV2.defaultID, info: undefined }),
            ).pipe(Effect.orDie)
            const materialized = yield* registry.materialize()
            const settlement = yield* materialized.settle({
              sessionID: session.id,
              agent: AgentV2.defaultID,
              assistantMessageID: SessionMessage.ID.make("msg_hosted_test"),
              call: { type: "tool-call", id: "call_hosted_echo", name: "hosted_echo", input: { text: "v2" } },
            })
            return { advertised, instructions, materialized, settlement }
          }),
        )
        expect(Object.keys(projected.advertised)).toEqual(["hosted_echo"])
        const definition = projected.materialized.definitions.find((item) => item.name === "hosted_echo")
        expect(definition?.description).toBe("Echo text through the hosted server")
        expect(definition?.inputSchema).toEqual({
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        })
        expect(projected.instructions.baseline).toBe(
          [
            "<mcp_instructions>",
            '  <server name="hosted">',
            "    Call the echo tool for hosted text.",
            "  </server>",
            "</mcp_instructions>",
          ].join("\n"),
        )
        expect(projected.settlement.result).toEqual({ type: "text", value: "hosted echo: v2" })
        expect(server.calls).toEqual([{ name: "echo", arguments: { text: "v2" } }])
      }),
    { timeout: 15000 },
  )

  it.live(
    "scopes the hosted MCP host to the Location's own directory",
    () =>
      Effect.gen(function* () {
        const server = yield* hosted
        const configuredDirectory = yield* tmpdirScoped({ config: configured(server.url) })
        const plainDirectory = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })

        const configuredTools = yield* inLocation(
          configuredDirectory,
          McpV2.Service.use((mcp) => mcp.tools()),
        )
        const plainTools = yield* inLocation(
          plainDirectory,
          McpV2.Service.use((mcp) => mcp.tools()),
        )

        expect(Object.keys(configuredTools)).toEqual(["hosted_echo"])
        expect(plainTools).toEqual({})
        expect(server.calls).toEqual([])
      }),
    { timeout: 15000 },
  )
})
