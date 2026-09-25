import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LspV2 } from "@opencode-ai/core/lsp"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { EditTool } from "@opencode-ai/core/tool/edit"
import { WriteTool } from "@opencode-ai/core/tool/write"
import { Effect, Layer } from "effect"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { settleTool, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_diagnostics_test")
const block = (file: string) => `<diagnostics file="${file}">\nERROR [1:1] broken\n</diagnostics>`

let report: (absolute: string) => Effect.Effect<LspV2.Report> = () => Effect.succeed({ file: "", project: [] })
let touched: string[] = []
let reportedFor: string[] = []

const lsp = Layer.effect(
  LspV2.Host,
  Effect.gen(function* () {
    return LspV2.Host.of({
      ...LspV2.disabledHost,
      report: (directory, absolute) =>
        Effect.sync(() => {
          touched.push(absolute)
          reportedFor.push(directory)
        }).pipe(Effect.andThen(report(absolute))),
    })
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
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
        LayerNode.group([
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          LocationMutation.node,
          FileMutation.node,
          LspV2.node,
          EditTool.node,
          WriteTool.node,
        ]),
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

const reset = () => {
  report = () => Effect.succeed({ file: "", project: [] })
  touched = []
  reportedFor = []
}

const it = testEffect(Layer.empty)

describe("LspV2 diagnostics at the tool leaves", () => {
  it.live("keeps the edit output unchanged when no diagnostics are reported", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "before\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                reset()
                const settled = yield* settleTool(registry, {
                  sessionID,
                  ...toolIdentity,
                  call: {
                    type: "tool-call",
                    id: "call-clean",
                    name: "edit",
                    input: { path: "file.txt", oldString: "before", newString: "after" },
                  },
                })
                expect(settled.output?.structured).not.toHaveProperty("diagnostics")
                expect(settled.output?.structured).toMatchObject({ replacements: 1 })
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("appends the v1 edit wording for the mutated file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "before\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                reset()
                report = (absolute) => Effect.succeed({ file: block(absolute), project: [] })
                const settled = yield* settleTool(registry, {
                  sessionID,
                  ...toolIdentity,
                  call: {
                    type: "tool-call",
                    id: "call-dirty",
                    name: "edit",
                    input: { path: "file.txt", oldString: "before", newString: "after" },
                  },
                })
                expect(touched).toEqual([path.join(tmp.path, "file.txt")])
                expect(reportedFor).toEqual([tmp.path])
                expect(settled.output?.structured).toMatchObject({
                  diagnostics: block(path.join(tmp.path, "file.txt")),
                })
                expect(settled.result).toMatchObject({
                  type: "text",
                  value: expect.stringContaining(
                    `LSP errors detected in this file, please fix:\n${block(path.join(tmp.path, "file.txt"))}`,
                  ),
                })
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("appends both the file and the bounded project sweep for write", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTools(tmp.path, (registry) =>
          Effect.gen(function* () {
            reset()
            report = () => Effect.succeed({ file: block("written.txt"), project: [block("other.ts")] })
            const settled = yield* settleTool(registry, {
              sessionID,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-write",
                name: "write",
                input: { path: "written.txt", content: "hello\n" },
              },
            })
            expect(settled.result).toMatchObject({
              type: "text",
              value: expect.stringContaining(
                `LSP errors detected in this file, please fix:\n${block("written.txt")}\n\nLSP errors detected in other files:\n${block("other.ts")}`,
              ),
            })
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("never fails a mutation when the language server fails", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "before\n")).pipe(
          Effect.andThen(
            withTools(tmp.path, (registry) =>
              Effect.gen(function* () {
                reset()
                report = () => Effect.die(new Error("language server crashed"))
                const settled = yield* settleTool(registry, {
                  sessionID,
                  ...toolIdentity,
                  call: {
                    type: "tool-call",
                    id: "call-crash",
                    name: "edit",
                    input: { path: "file.txt", oldString: "before", newString: "after" },
                  },
                })
                expect(settled.result.type).toBe("text")
                expect(settled.output?.structured).not.toHaveProperty("diagnostics")
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
