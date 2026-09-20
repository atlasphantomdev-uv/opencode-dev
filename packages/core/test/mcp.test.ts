import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { McpV2 } from "@opencode-ai/core/mcp"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SystemContext } from "@opencode-ai/core/system-context"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect, Layer, Queue, Stream } from "effect"
import { fileURLToPath } from "url"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const directory = fileURLToPath(new URL("./fixture", import.meta.url))
const sessionID = SessionV2.ID.make("ses_mcp_test")

/** A host advertises raw JSON Schema tools and executes them itself, exactly like an MCP server. */
const remoteEcho = (name: string, version: string): McpV2.AdvertisedTool => ({
  name,
  description: `Echo through ${version}`,
  jsonSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  execute: (input) => Effect.succeed([{ type: "text" as const, text: `${version}: ${JSON.stringify(input)}` }]),
})

let servers: ReadonlyArray<McpV2.Server> = []
let advertised: ReadonlyArray<McpV2.AdvertisedTool> = []
let changes: Queue.Queue<void> | undefined

const host = Layer.effect(
  McpV2.Host,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<void>()
    changes = queue
    return McpV2.Host.of({
      servers: () => Effect.sync(() => servers),
      tools: () => Effect.sync(() => advertised),
      changed: () => Stream.fromQueue(queue),
    })
  }),
)

const asked: PermissionV2.AssertInput[] = []

const permission = Layer.mock(PermissionV2.Service, {
  assert: (input) => Effect.sync(() => asked.push(input)),
})

const withHost = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, McpV2.node, McpV2.toolsNode]), [
        [McpV2.hostNode, host],
        [
          Location.node,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ],
        [PermissionV2.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )

const settleMcpTool = (registry: ToolRegistry.Interface, name: string, input: unknown) =>
  settleTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: `call-${name}`, name, input },
  })

const waitFor = (predicate: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (yield* predicate) return
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(new Error("timed out waiting for MCP tool refresh"))
  })

const names = (registry: ToolRegistry.Interface) =>
  toolDefinitions(registry).pipe(Effect.map((definitions) => definitions.map((tool) => tool.name)))

const reset = () => {
  servers = []
  advertised = []
  asked.length = 0
}

const agent = (permissions: PermissionV2.Ruleset = []) => ({
  id: AgentV2.ID.make("build"),
  info: AgentV2.Info.make({ ...AgentV2.Info.empty(AgentV2.ID.make("build")), permissions }),
})

const it = testEffect(Layer.empty)

describe("McpV2", () => {
  it.live("registers host-advertised JSON Schema tools as canonical registrations", () => {
    reset()
    advertised = [remoteEcho("mcp__fake__echo", "fake")]
    return withHost((registry) =>
      Effect.gen(function* () {
        const definitions = yield* toolDefinitions(registry)
        expect(definitions.map((tool) => tool.name)).toEqual(["mcp__fake__echo"])
        expect(definitions[0]?.inputSchema).toEqual({
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        })
        expect(yield* settleMcpTool(registry, "mcp__fake__echo", { text: "hi" })).toMatchObject({
          result: { type: "text", value: 'fake: {"text":"hi"}' },
        })
        expect(asked).toEqual([
          {
            action: "mcp__fake__echo",
            resources: ["*"],
            save: ["*"],
            sessionID,
            agent: toolIdentity.agent,
            source: { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call-mcp__fake__echo" },
          },
        ])
      }),
    )
  })

  it.live("replaces the registration set when the host advertises a change", () => {
    reset()
    advertised = [remoteEcho("mcp__fake__first", "first")]
    return withHost((registry) =>
      Effect.gen(function* () {
        expect(yield* names(registry)).toEqual(["mcp__fake__first"])

        advertised = [remoteEcho("mcp__fake__second", "second")]
        yield* Queue.offer(changes!, undefined)

        yield* waitFor(
          names(registry).pipe(Effect.map((current) => current.length === 1 && current[0] === "mcp__fake__second")),
        )
        expect(yield* settleMcpTool(registry, "mcp__fake__second", {})).toMatchObject({
          result: { type: "text", value: "second: {}" },
        })
      }),
    )
  })

  it.live("drops a disconnecting host's registrations", () => {
    reset()
    advertised = [remoteEcho("mcp__fake__gone", "gone")]
    return withHost((registry) =>
      Effect.gen(function* () {
        expect(yield* names(registry)).toEqual(["mcp__fake__gone"])

        advertised = []
        yield* Queue.offer(changes!, undefined)

        yield* waitFor(names(registry).pipe(Effect.map((current) => current.length === 0)))
      }),
    )
  })

  it.live("ignores an invalid advertised name without failing the location", () => {
    reset()
    advertised = [remoteEcho("invalid name", "invalid")]
    return withHost((registry) =>
      Effect.gen(function* () {
        expect(yield* names(registry)).toEqual([])

        advertised = [remoteEcho("mcp__fake__valid", "valid")]
        yield* Queue.offer(changes!, undefined)

        yield* waitFor(names(registry).pipe(Effect.map((current) => current.length === 1)))
      }),
    )
  })

  it.effect("renders applicable server instructions in the v1 shape", () =>
    Effect.gen(function* () {
      reset()
      servers = [
        { name: "fake", instructions: "Use the fake server.", tools: [] },
        { name: "denied", instructions: "Never reachable.", tools: ["mcp__denied__tool"] },
      ]
      return yield* withHost((registry) =>
        Effect.gen(function* () {
          void registry
          const mcp = yield* McpV2.Service
          const generation = yield* SystemContext.initialize(
            yield* mcp.instructions(agent([{ action: "mcp__denied__*", resource: "*", effect: "deny" }])),
          ).pipe(Effect.orDie)
          expect(generation.baseline).toBe(
            [
              "<mcp_instructions>",
              '  <server name="fake">',
              "    Use the fake server.",
              "  </server>",
              "</mcp_instructions>",
            ].join("\n"),
          )
        }),
      )
    }),
  )

  it.effect("reports an empty context when no server applies", () =>
    Effect.gen(function* () {
      reset()
      return yield* withHost(() =>
        Effect.gen(function* () {
          const mcp = yield* McpV2.Service
          const generation = yield* SystemContext.initialize(yield* mcp.instructions(agent())).pipe(Effect.orDie)
          expect(generation.baseline).toBe("")
          servers = [{ name: "denied", instructions: "Never reachable.", tools: ["mcp__denied__tool"] }]
          const denied = yield* SystemContext.initialize(
            yield* mcp.instructions(agent([{ action: "mcp__denied__*", resource: "*", effect: "deny" }])),
          ).pipe(Effect.orDie)
          expect(denied.baseline).toBe("")
        }),
      )
    }),
  )
})
