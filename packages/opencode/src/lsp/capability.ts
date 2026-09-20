export * as LspCapability from "./capability"

import { FSUtil } from "@opencode-ai/core/fs-util"
import { LspV2 } from "@opencode-ai/core/lsp"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { LSP } from "@/lsp/lsp"
import { InstanceStore } from "@/project/instance-store"
import { MAX_PROJECT_DIAGNOSTICS_FILES } from "@/tool/write"

/**
 * V2 language-server host.
 *
 * Core declares the `LspV2` capability and a `LspV2.hostNode` placeholder inside the Location tree;
 * this layer is what its hosts replace that placeholder with. Rendering, mime policy, and limits stay
 * in one place: the v1 diagnostic module owns the block format and the write leaf owns the
 * project-sweep bound. The layer takes its services from the application graph because the Location
 * tree cannot: the instance store is global, and hoisting it would rebuild it per Location.
 */
export const layer = Layer.effect(
  LspV2.Host,
  Effect.gen(function* () {
    const instances = yield* InstanceStore.Service
    const lsp = yield* LSP.Service

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
    })
  }),
)
