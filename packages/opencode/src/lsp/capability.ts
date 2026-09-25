export * as LspCapability from "./capability"

import { FSUtil } from "@opencode-ai/core/fs-util"
import { LspV2 } from "@opencode-ai/core/lsp"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { pathToFileURL } from "url"
import { LSP } from "@/lsp/lsp"
import { InstanceStore } from "@/project/instance-store"
import { MAX_PROJECT_DIAGNOSTICS_FILES } from "@/tool/write"

/**
 * V2 language-server host.
 *
 * Core declares the `LspV2` capability and a `LspV2.hostNode` placeholder inside the Location tree;
 * this layer is what its hosts replace that placeholder with. Rendering, mime policy, and limits stay
 * in one place: the v1 diagnostic module owns the block format and the write leaf owns the
 * project-sweep bound. Navigation delegates to the same v1 `LSP.Service`; core only owns the seam
 * types. The layer takes its services from the application graph because the Location
 * tree cannot: the instance store is global, and hoisting it would rebuild it per Location.
 */
export const layer = Layer.effect(
  LspV2.Host,
  Effect.gen(function* () {
    const instances = yield* InstanceStore.Service
    const lsp = yield* LSP.Service

    const withInstance = <A, E, R>(directory: AbsolutePath, effect: Effect.Effect<A, E, R>) =>
      instances.provide({ directory }, effect)

    return LspV2.Host.of({
      report: Effect.fn("LspCapability.report")(function* (directory: AbsolutePath, path: string) {
        return yield* instances.provide(
          { directory },
          Effect.gen(function* () {
            yield* lsp.touchFile(path, "document")
            const diagnostics = yield* lsp.diagnostics()
            const normalized = FSUtil.normalizePath(path)
            return {
              file: LSP.Diagnostic.report(path, diagnostics[normalized] ?? []),
              project: Object.entries(diagnostics)
                .filter(([file]) => file !== normalized)
                .flatMap(([file, issues]) => {
                  const block = LSP.Diagnostic.report(file, issues)
                  return block ? [block] : []
                })
                .slice(0, MAX_PROJECT_DIAGNOSTICS_FILES),
            }
          }),
        )
      }),
      hasClients: Effect.fn("LspCapability.hasClients")(function* (directory: AbsolutePath, file: string) {
        return yield* withInstance(directory, lsp.hasClients(file))
      }),
      touchFile: Effect.fn("LspCapability.touchFile")(function* (
        directory: AbsolutePath,
        file: string,
        diagnostics?: "document" | "full",
      ) {
        return yield* withInstance(directory, lsp.touchFile(file, diagnostics))
      }),
      hover: Effect.fn("LspCapability.hover")(function* (directory: AbsolutePath, input: LspV2.LocInput) {
        return yield* withInstance(directory, lsp.hover(input))
      }),
      definition: Effect.fn("LspCapability.definition")(function* (directory: AbsolutePath, input: LspV2.LocInput) {
        return yield* withInstance(directory, lsp.definition(input))
      }),
      references: Effect.fn("LspCapability.references")(function* (directory: AbsolutePath, input: LspV2.LocInput) {
        return yield* withInstance(directory, lsp.references(input))
      }),
      implementation: Effect.fn("LspCapability.implementation")(function* (
        directory: AbsolutePath,
        input: LspV2.LocInput,
      ) {
        return yield* withInstance(directory, lsp.implementation(input))
      }),
      documentSymbol: Effect.fn("LspCapability.documentSymbol")(function* (directory: AbsolutePath, file: string) {
        return yield* withInstance(directory, lsp.documentSymbol(pathToFileURL(file).href))
      }),
      workspaceSymbol: Effect.fn("LspCapability.workspaceSymbol")(function* (directory: AbsolutePath, query: string) {
        return yield* withInstance(directory, lsp.workspaceSymbol(query))
      }),
      prepareCallHierarchy: Effect.fn("LspCapability.prepareCallHierarchy")(function* (
        directory: AbsolutePath,
        input: LspV2.LocInput,
      ) {
        return yield* withInstance(directory, lsp.prepareCallHierarchy(input))
      }),
      incomingCalls: Effect.fn("LspCapability.incomingCalls")(function* (
        directory: AbsolutePath,
        input: LspV2.LocInput,
      ) {
        return yield* withInstance(directory, lsp.incomingCalls(input))
      }),
      outgoingCalls: Effect.fn("LspCapability.outgoingCalls")(function* (
        directory: AbsolutePath,
        input: LspV2.LocInput,
      ) {
        return yield* withInstance(directory, lsp.outgoingCalls(input))
      }),
    })
  }),
)
