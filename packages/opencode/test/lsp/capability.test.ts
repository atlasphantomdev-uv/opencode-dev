import { describe, expect, test } from "bun:test"
import { LspV2 } from "@opencode-ai/core/lsp"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { pathToFileURL } from "url"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import type { Diagnostic } from "@/lsp/client"
import { LSP } from "@/lsp/lsp"
import { LspCapability } from "@/lsp/capability"
import { InstanceStore } from "@/project/instance-store"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make("/project")

const diagnostic = (message: string): Diagnostic => ({
  severity: 1,
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
})

let touched: string[] = []
let reported: Record<string, Diagnostic[]> = {}
const provided: string[] = []

/**
 * `FSUtil.normalizePath` realpaths, so the mock keys are already-normalized paths and the host must
 * compare the normalized path rather than the caller's spelling.
 */
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }

const lsp = Layer.mock(LSP.Service, {
  touchFile: (path) => Effect.sync(() => touched.push(path)),
  diagnostics: () => Effect.sync(() => reported),
  hasClients: () => Effect.succeed(true),
  definition: (input: { file: string; line: number; character: number }) =>
    Effect.succeed([{ uri: pathToFileURL(input.file).href, line: input.line, character: input.character }]),
  documentSymbol: (uri: string) => Effect.succeed([{ name: uri, kind: 12, range, selectionRange: range }]),
  workspaceSymbol: (query: string) =>
    Effect.succeed([{ name: query, kind: 12, location: { uri: "file:///project/file.ts", range } }]),
})

const instances = Layer.mock(InstanceStore.Service, {
  provide: (input, effect) => Effect.sync(() => provided.push(input.directory)).pipe(Effect.andThen(effect)),
})

const env = LspCapability.layer.pipe(Layer.provide(Layer.mergeAll(lsp, instances)))
const it = testEffect(env)

const reset = () => {
  touched = []
  reported = {}
  provided.length = 0
}

describe("LspCapability", () => {
  it.effect("reports the current file block and a bounded project sweep for the requested directory", () =>
    Effect.gen(function* () {
      reset()
      reported = {
        "/project/file.ts": [diagnostic("broken")],
        "/project/other.ts": [diagnostic("other")],
        "/project/third.ts": [diagnostic("third")],
      }
      const host = yield* LspV2.Host

      const report = yield* host.report(directory, "/project/file.ts")

      expect(touched).toEqual(["/project/file.ts"])
      expect(provided).toEqual(["/project"])
      expect(report.file).toBe('<diagnostics file="/project/file.ts">\nERROR [1:1] broken\n</diagnostics>')
      expect(report.project).toEqual([
        '<diagnostics file="/project/other.ts">\nERROR [1:1] other\n</diagnostics>',
        '<diagnostics file="/project/third.ts">\nERROR [1:1] third\n</diagnostics>',
      ])
    }),
  )

  it.effect("caps the project sweep at the v1 bound of five files", () =>
    Effect.gen(function* () {
      reset()
      reported = Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`/project/file${index}.ts`, [diagnostic(`error ${index}`)]]),
      )
      const host = yield* LspV2.Host

      const report = yield* host.report(directory, "/project/file0.ts")

      expect(report.project).toHaveLength(5)
    }),
  )

  it.effect("reports nothing for a clean file or an absent server state", () =>
    Effect.gen(function* () {
      reset()
      reported = { "/project/file.ts": [{ ...diagnostic("warning"), severity: 2 }] }
      const host = yield* LspV2.Host

      const report = yield* host.report(directory, "/project/file.ts")

      expect(report.file).toBe("")
      expect(report.project).toEqual([])
    }),
  )

  it.effect("routes navigation through the v1 service inside the requested directory", () =>
    Effect.gen(function* () {
      reset()
      const file = "/project/file.ts"
      const host = yield* LspV2.Host

      expect(yield* host.hasClients(directory, file)).toBe(true)
      expect(yield* host.definition(directory, { file, line: 2, character: 3 })).toEqual([
        { uri: pathToFileURL(file).href, line: 2, character: 3 },
      ])
      expect(yield* host.documentSymbol(directory, file)).toEqual([
        { name: pathToFileURL(file).href, kind: 12, range, selectionRange: range },
      ])
      expect(yield* host.workspaceSymbol(directory, "clip")).toEqual([
        { name: "clip", kind: 12, location: { uri: "file:///project/file.ts", range } },
      ])
      expect(provided).toEqual(["/project", "/project", "/project", "/project"])
    }),
  )
})

test("the host replacement binds the core placeholder to this capability", () => {
  const replacement = AppNodeBuilderV1.hostReplacements.find(([source]) => source.name === LspV2.hostNode.name)

  expect(replacement?.[0]).toBe(LspV2.hostNode)
  expect(replacement?.[1]).toBe(LspCapability.layer)
})
