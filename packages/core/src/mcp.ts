export * as McpV2 from "./mcp"

import { Context, Effect, Exit, JsonSchema, Layer, Ref, Schema, Scope, Stream } from "effect"
import { ToolFailure } from "@opencode-ai/llm"
import { AgentV2 } from "./agent"
import { Location } from "./location"
import { Node, makeLocationNode } from "./effect/app-node"
import { LayerNode } from "./effect/layer-node"
import { PermissionV2 } from "./permission"
import { AbsolutePath } from "./schema"
import { SystemContext } from "./system-context/index"
import { ToolRegistry } from "./tool/registry"
import { Tool, type AnyTool, type Content } from "./tool/tool"
import { Tools } from "./tool/tools"

/** One MCP server's instructions as its transport reports them. */
export interface Server {
  readonly name: string
  readonly instructions: string
  /** Model-facing tool names the server advertises; an empty list means the server exposes none. */
  readonly tools: ReadonlyArray<string>
}

/** One MCP tool in the shape core needs to register it as a canonical Location tool. */
export interface AdvertisedTool {
  /** Model-facing tool name, already namespaced by the host. */
  readonly name: string
  readonly description: string
  /** The server's own input schema. Core never rewrites it: the server validates its own input. */
  readonly jsonSchema: JsonSchema.JsonSchema
  /** Performs the remote call and returns already-projected model content. */
  readonly execute: (input: unknown) => Effect.Effect<ReadonlyArray<Content>, ToolFailure>
}

/**
 * Location host accessor for Model Context Protocol servers.
 *
 * Core owns how MCP servers contribute system context and canonical tools; it does not own
 * transports, authentication, or client lifecycle, because those live in the host that ships
 * them. The placeholder sits in the Location tree, so a host binds it where the Location is
 * assembled — mirroring the `Location.boundNode` seam — as a Location node or as a layer that takes
 * its services from the application graph. Without a host replacement the default node advertises no
 * servers.
 */
export interface HostInterface {
  readonly servers: (directory: AbsolutePath) => Effect.Effect<ReadonlyArray<Server>>
  readonly tools: (directory: AbsolutePath) => Effect.Effect<ReadonlyArray<AdvertisedTool>>
  /** Emits when the advertised tool set may have changed. */
  readonly changed: () => Stream.Stream<void>
}

export class Host extends Context.Service<Host, HostInterface>()("@opencode/v2/McpHost") {}

export const hostNode = LayerNode.unbound(Host, Node.tags.values.location)

export const disabledHostNode = makeLocationNode({
  service: Host,
  layer: Layer.succeed(
    Host,
    Host.of({ servers: () => Effect.succeed([]), tools: () => Effect.succeed([]), changed: () => Stream.empty }),
  ),
  deps: [],
})

/**
 * Location-scoped MCP capability consumed by the V2 runtime.
 *
 * Core owns the seam; hosts own the servers. The default host advertises nothing, which keeps
 * the V2 runtime usable where no MCP transport ships.
 */
export interface Interface {
  /** Server instructions as a refreshable system-context source; empty when no server applies. */
  readonly instructions: (agent: AgentV2.Selection) => Effect.Effect<SystemContext.SystemContext>
  /** Currently advertised tools keyed by their model-facing name. */
  readonly tools: () => Effect.Effect<Readonly<Record<string, AnyTool>>>
  /** Emits when the advertised tool set may have changed. */
  readonly changed: () => Stream.Stream<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Mcp") {}

const Renderable = Schema.Struct({ name: Schema.String, instructions: Schema.String })

const key = SystemContext.Key.make("core/mcp-instructions")

/** Model-facing rendering shared in shape with the v1 system prompt. */
const render = (servers: ReadonlyArray<typeof Renderable.Type>) =>
  [
    "<mcp_instructions>",
    ...servers.flatMap((server) => [
      `  <server name="${server.name}">`,
      ...server.instructions.split("\n").map((line) => `    ${line}`),
      "  </server>",
    ]),
    "</mcp_instructions>",
  ].join("\n")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const host = yield* Host
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    return Service.of({
      instructions: Effect.fn("Mcp.instructions")(function* (agent) {
        const rules = agent.info?.permissions ?? []
        const servers = (yield* host.servers(location.directory))
          .filter(
            (server) =>
              server.tools.length === 0 ||
              server.tools.some((tool) => PermissionV2.evaluate(tool, "*", rules).effect !== "deny"),
          )
          .map((server) => ({ name: server.name, instructions: server.instructions }))
        if (servers.length === 0) return SystemContext.empty
        return SystemContext.make({
          key,
          codec: Schema.toCodecJson(Schema.Array(Renderable)),
          load: Effect.succeed(servers),
          baseline: render,
          update: (_previous, current) =>
            [
              "The MCP server instructions have changed. This list supersedes the previous MCP instructions.",
              render(current),
            ].join("\n"),
          removed: () =>
            "MCP server instructions are no longer available. Do not use any previously listed MCP server instructions.",
        })
      }),
      tools: Effect.fn("Mcp.tools")(function* () {
        const registered: Record<string, AnyTool> = {}
        for (const advertised of yield* host.tools(location.directory)) {
          registered[advertised.name] = Tool.withPermission(
            Tool.make({
              description: advertised.description,
              jsonSchema: advertised.jsonSchema,
              execute: (input, context) =>
                permission
                  .assert({
                    action: advertised.name,
                    resources: ["*"],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  // A refused remote call is model-facing content, not a runtime failure.
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new ToolFailure({
                          message:
                            error._tag === "PermissionV2.CorrectedError"
                              ? error.feedback
                              : `Permission denied for MCP tool ${advertised.name}`,
                          error,
                        }),
                    ),
                  )
                  .pipe(Effect.andThen(advertised.execute(input))),
              // The registered execute always yields this shape; the dynamic tool mode types output
              // as `unknown` so externally owned schemas stay opaque to core.
              toModelOutput: ({ output }) => output as ReadonlyArray<Content>,
            }),
            advertised.name,
          )
        }
        return registered
      }),
      changed: () => host.changed(),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [hostNode, Location.node, PermissionV2.node],
})

/**
 * Registers host-advertised MCP tools as scoped canonical Location registrations.
 *
 * MCP tool sets change while a Location lives: servers connect, disconnect, or advertise a new
 * list. Each refresh registers into a dedicated child scope, so the newest set wins and every
 * earlier registration is dropped.
 */
export const toolsNode = makeLocationNode({
  name: "mcp-tools",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const mcp = yield* Service
      const registry = yield* Tools.Service
      const current = yield* Ref.make<Scope.Closeable | undefined>(undefined)

      const sync = Effect.fnUntraced(function* () {
        const previous = yield* Ref.getAndSet(current, undefined)
        if (previous) yield* Scope.close(previous, Exit.void)
        const advertised = yield* mcp.tools()
        if (Object.keys(advertised).length === 0) return
        const scope = yield* Scope.make()
        yield* registry.register({ ...advertised }).pipe(
          Scope.provide(scope),
          Effect.catch((error) =>
            Scope.close(scope, Exit.void).pipe(
              Effect.andThen(Effect.logWarning("ignoring invalid MCP tool registration", { error: error.message })),
            ),
          ),
        )
        yield* Ref.set(current, scope)
      })

      yield* sync()
      yield* Stream.runForEach(mcp.changed(), () => sync()).pipe(Effect.forkScoped)
      yield* Effect.addFinalizer(() =>
        Ref.get(current).pipe(Effect.flatMap((scope) => (scope ? Scope.close(scope, Exit.void) : Effect.void))),
      )
    }),
  ),
  deps: [node, ToolRegistry.node],
})
