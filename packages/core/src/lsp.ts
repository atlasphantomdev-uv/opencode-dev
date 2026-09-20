export * as LspV2 from "./lsp"

import { Context, Effect, Layer } from "effect"
import { Location } from "./location"
import { Node, makeLocationNode } from "./effect/app-node"
import { LayerNode } from "./effect/layer-node"
import type { AbsolutePath } from "./schema"

/**
 * What a host reports after a file mutation.
 *
 * Hosts own discovery, spawning, and querying of language servers; core owns only which report
 * reaches the model and when. Rendering matches the v1 model-facing blocks so both runtimes teach
 * the model the same way.
 */
export interface Report {
  /** Rendered `<diagnostics>` block for the mutated file, or an empty string when it is clean. */
  readonly file: string
  /** Blocks for other Location files with errors, bounded like the v1 project sweep. */
  readonly project: ReadonlyArray<string>
}

/**
 * Location host accessor for language-server diagnostics.
 *
 * The placeholder sits in the Location tree, so the host that ships an LSP binds it where the
 * Location is assembled — mirroring the `Location.boundNode` seam — as a Location node or as a
 * layer that takes its services from the application graph. Without a host replacement the default
 * node reports nothing.
 */
export interface HostInterface {
  readonly report: (directory: AbsolutePath, path: string) => Effect.Effect<Report>
}

export class Host extends Context.Service<Host, HostInterface>()("@opencode/v2/LspHost") {}

const empty: Report = { file: "", project: [] }

export const hostNode = LayerNode.unbound(Host, Node.tags.values.location)

export const disabledHostNode = makeLocationNode({
  service: Host,
  layer: Layer.succeed(Host, Host.of({ report: () => Effect.succeed(empty) })),
  deps: [],
})

/**
 * Location-scoped diagnostics capability consumed by the V2 file tools.
 *
 * Core owns when diagnostics are collected and how they reach the model; the host owns the
 * servers. The default host reports nothing, which keeps V2 file tools usable without an LSP host.
 */
export interface Interface {
  /**
   * Notifies the Location's language server that `path` changed and returns the current
   * diagnostics report for the Location or an empty report when no server is available.
   */
  readonly report: (path: string) => Effect.Effect<Report>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Lsp") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const host = yield* Host
    const location = yield* Location.Service

    return Service.of({ report: (path) => host.report(location.directory, path) })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [hostNode, Location.node] })

/** Diagnostics are advisory: a failing or missing language server must never fail a mutation. */
export const reportSafe = (service: Interface, path: string) =>
  service.report(path).pipe(Effect.catchCause(() => Effect.succeed(empty)))
