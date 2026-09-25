import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LspV2 } from "@opencode-ai/core/lsp"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { LspTool } from "@opencode-ai/core/tool/lsp"
import { Effect, Layer } from "effect"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_lsp_tool_test")

const operations = [
  ["goToDefinition", "definition"],
  ["findReferences", "references"],
  ["hover", "hover"],
  ["documentSymbol", "documentSymbol"],
  ["workspaceSymbol", "workspaceSymbol"],
  ["goToImplementation", "implementation"],
  ["prepareCallHierarchy", "prepareCallHierarchy"],
  ["incomingCalls", "incomingCalls"],
  ["outgoingCalls", "outgoingCalls"],
] as const

let available = true
let emptyResults = false
let calls: string[] = []
let touched: string[] = []
const assertions: PermissionV2.AssertInput[] = []

const reset = () => {
  available = true
  emptyResults = false
  calls = []
  touched = []
  assertions.length = 0
}

const op = (method: string) =>
  Effect.sync(() => {
    calls.push(method)
    return emptyResults ? [] : [{ method }]
  })

const lsp = Layer.succeed(
  LspV2.Host,
  LspV2.Host.of({
    ...LspV2.disabledHost,
    hasClients: () =>
      Effect.sync(() => {
        calls.push("hasClients")
        return available
      }),
    touchFile: (_directory, file) =>
      Effect.sync(() => {
        calls.push("touchFile")
        touched.push(file)
      }),
    hover: () => op("hover"),
    definition: () => op("definition"),
    references: () => op("references"),
    implementation: () => op("implementation"),
    documentSymbol: () => op("documentSymbol"),
    workspaceSymbol: () => op("workspaceSymbol"),
    prepareCallHierarchy: () => op("prepareCallHierarchy"),
    incomingCalls: () => op("incomingCalls"),
    outgoingCalls: () => op("outgoingCalls"),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTools = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, LspV2.node, LspTool.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [LspV2.hostNode, lsp],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const it = testEffect(Layer.empty)

const call = (id: string, input: { operation: string; filePath: string; line?: number; character?: number }) =>
  ({
    type: "tool-call" as const,
    id,
    name: "lsp",
    input: { line: 1, character: 1, ...input },
  }) as const

describe("LspTool", () => {
  it.live("dispatches every operation through the lsp permission and touches the file first", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.ts"), "const x = 1\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                const file = path.join(tmp.path, "file.ts")
                for (const [operation, method] of operations) {
                  reset()
                  const settled = yield* settleTool(registry, {
                    sessionID,
                    ...toolIdentity,
                    call: call(`call-${operation}`, { operation, filePath: "file.ts" }),
                  })
                  expect(settled.output?.structured).toMatchObject({ result: [{ method }] })
                  expect(calls).toEqual(["hasClients", "touchFile", method])
                  expect(touched).toEqual([file])
                  const metadata =
                    operation === "workspaceSymbol"
                      ? { operation }
                      : operation === "documentSymbol"
                        ? { operation, filePath: file }
                        : { operation, filePath: file, line: 1, character: 1 }
                  expect(assertions).toMatchObject([
                    { sessionID, action: "lsp", resources: ["*"], save: ["*"], metadata },
                  ])
                }
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("fails with the v1 wording when no language server is available", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.ts"), "const x = 1\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                reset()
                available = false
                expect(
                  yield* executeTool(registry, {
                    sessionID,
                    ...toolIdentity,
                    call: call("call-no-server", { operation: "hover", filePath: "file.ts" }),
                  }),
                ).toEqual({ type: "error", value: "No LSP server available for this file type." })
                expect(calls).toEqual(["hasClients"])
                expect(touched).toEqual([])
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("returns the v1 empty-result message when an operation finds nothing", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.ts"), "const x = 1\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                reset()
                emptyResults = true
                expect(
                  yield* executeTool(registry, {
                    sessionID,
                    ...toolIdentity,
                    call: call("call-empty", { operation: "hover", filePath: "file.ts" }),
                  }),
                ).toEqual({ type: "text", value: "No results found for hover" })
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects a missing file after authorization", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTools(tmp.path, (registry) =>
          Effect.gen(function* () {
            reset()
            const result = yield* executeTool(registry, {
              sessionID,
              ...toolIdentity,
              call: call("call-missing", { operation: "hover", filePath: "missing.ts" }),
            })
            expect(result).toMatchObject({
              type: "error",
              value: `File not found: ${path.join(tmp.path, "missing.ts")}`,
            })
            expect(calls).toEqual([])
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
