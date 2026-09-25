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

/** Zero-based position, matching the v1 `LocInput` a host forwards to its language server. */
export interface LocInput {
  readonly file: string
  readonly line: number
  readonly character: number
}

/**
 * Location host accessor for language-server diagnostics and navigation.
 *
 * The placeholder sits in the Location tree, so the host that ships an LSP binds it where the
 * Location is assembled — mirroring the `Location.boundNode` seam — as a Location node or as a
 * layer that takes its services from the application graph. Without a host replacement the default
 * node reports nothing and returns no navigation results.
 */
export interface HostInterface {
  readonly report: (directory: AbsolutePath, path: string) => Effect.Effect<Report>
  readonly hasClients: (directory: AbsolutePath, file: string) => Effect.Effect<boolean>
  readonly touchFile: (directory: AbsolutePath, file: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly hover: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly definition: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly references: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly implementation: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly documentSymbol: (directory: AbsolutePath, file: string) => Effect.Effect<ReadonlyArray<unknown>>
  readonly workspaceSymbol: (directory: AbsolutePath, query: string) => Effect.Effect<ReadonlyArray<unknown>>
  readonly prepareCallHierarchy: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly incomingCalls: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly outgoingCalls: (directory: AbsolutePath, input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
}

export class Host extends Context.Service<Host, HostInterface>()("@opencode/v2/LspHost") {}

const empty: Report = { file: "", project: [] }
const emptyResults: ReadonlyArray<unknown> = []

/**
 * Default host used when no LSP host is bound: no servers, so navigation is empty and mutations
 * stay usable.
 */
export const disabledHost: HostInterface = {
  report: () => Effect.succeed(empty),
  hasClients: () => Effect.succeed(false),
  touchFile: () => Effect.void,
  hover: () => Effect.succeed(emptyResults),
  definition: () => Effect.succeed(emptyResults),
  references: () => Effect.succeed(emptyResults),
  implementation: () => Effect.succeed(emptyResults),
  documentSymbol: () => Effect.succeed(emptyResults),
  workspaceSymbol: () => Effect.succeed(emptyResults),
  prepareCallHierarchy: () => Effect.succeed(emptyResults),
  incomingCalls: () => Effect.succeed(emptyResults),
  outgoingCalls: () => Effect.succeed(emptyResults),
}

export const hostNode = LayerNode.unbound(Host, Node.tags.values.location)

export const disabledHostNode = makeLocationNode({
  service: Host,
  layer: Layer.succeed(Host, Host.of(disabledHost)),
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
  /** True when a language server is configured for `file`'s type in this Location. */
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  /** Opens `file` so the language server tracks it; `diagnostics` waits for a report when set. */
  readonly touchFile: (file: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly hover: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly definition: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly references: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly implementation: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly documentSymbol: (file: string) => Effect.Effect<ReadonlyArray<unknown>>
  readonly workspaceSymbol: (query: string) => Effect.Effect<ReadonlyArray<unknown>>
  readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly incomingCalls: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
  readonly outgoingCalls: (input: LocInput) => Effect.Effect<ReadonlyArray<unknown>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Lsp") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const host = yield* Host
    const location = yield* Location.Service

    return Service.of({
      report: (path) => host.report(location.directory, path),
      hasClients: (file) => host.hasClients(location.directory, file),
      touchFile: (file, diagnostics) => host.touchFile(location.directory, file, diagnostics),
      hover: (input) => host.hover(location.directory, input),
      definition: (input) => host.definition(location.directory, input),
      references: (input) => host.references(location.directory, input),
      implementation: (input) => host.implementation(location.directory, input),
      documentSymbol: (file) => host.documentSymbol(location.directory, file),
      workspaceSymbol: (query) => host.workspaceSymbol(location.directory, query),
      prepareCallHierarchy: (input) => host.prepareCallHierarchy(location.directory, input),
      incomingCalls: (input) => host.incomingCalls(location.directory, input),
      outgoingCalls: (input) => host.outgoingCalls(location.directory, input),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [hostNode, Location.node] })

/** Diagnostics are advisory: a failing or missing language server must never fail a mutation. */
export const reportSafe = (service: Interface, path: string) =>
  service.report(path).pipe(Effect.catchCause(() => Effect.succeed(empty)))
