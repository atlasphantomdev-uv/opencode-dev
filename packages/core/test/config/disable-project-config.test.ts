import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { Policy } from "@opencode-ai/core/policy"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function testLayer(directory: string, globalDirectory: string, projectDirectory = directory) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(projectDirectory) }),
    ),
  )
  return AppNodeBuilder.build(LayerNode.group([Config.node, Policy.node]), [
    [Location.node, locationLayer],
    [Global.node, Global.layerWith({ config: globalDirectory })],
  ])
}

/**
 * Sets the flag for the duration of `effect`. The Flag getter reads `process.env`
 * at access time, so mutating the variable here is observed by Config discovery.
 */
const withFlag = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env["OPENCODE_DISABLE_PROJECT_CONFIG"]
      if (value === undefined) delete process.env["OPENCODE_DISABLE_PROJECT_CONFIG"]
      else process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = value
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env["OPENCODE_DISABLE_PROJECT_CONFIG"]
        else process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = previous
      }),
  )

/**
 * Builds a workspace with global config plus project-tree config, then reports what
 * Config discovery returned.
 *
 * V1 parity reference: `packages/opencode/src/config/config.ts:420` skips
 * `ConfigPaths.files(...)` and `packages/opencode/src/config/paths.ts:27` skips the
 * project `.opencode` walk when OPENCODE_DISABLE_PROJECT_CONFIG is set, while global
 * config still loads.
 */
const discover = (flag: string | undefined) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((tmp) => {
      const global = path.join(tmp.path, "global")
      const root = path.join(tmp.path, "repo")
      const directory = path.join(root, "app")
      return Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(global, { recursive: true })
          await fs.mkdir(directory, { recursive: true })
          await fs.mkdir(path.join(root, ".opencode"), { recursive: true })
          await Promise.all([
            fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ $schema: "global" })),
            fs.writeFile(path.join(root, "opencode.json"), JSON.stringify({ $schema: "root" })),
            fs.writeFile(path.join(directory, "opencode.json"), JSON.stringify({ $schema: "directory" })),
            fs.writeFile(path.join(root, ".opencode", "opencode.json"), JSON.stringify({ $schema: "root-dot" })),
          ])
        })

        return yield* withFlag(
          flag,
          Effect.gen(function* () {
            const config = yield* Config.Service
            const entries = yield* config.entries()
            return {
              documents: entries.flatMap((entry) => (entry.type === "document" ? [entry.info.$schema] : [])),
              directories: entries.flatMap((entry) => (entry.type === "directory" ? [entry.path as string] : [])),
              projectRoot: root,
              globalRoot: global,
            }
          }).pipe(Effect.provide(testLayer(directory, global, root))),
        )
      })
    }),
    Effect.scoped,
  )

describe("OPENCODE_DISABLE_PROJECT_CONFIG", () => {
  it.live("discovers project config documents when the flag is unset", () =>
    Effect.gen(function* () {
      const result = yield* discover(undefined)

      // Baseline: without the flag every project document is discovered.
      expect(result.documents).toEqual(["global", "root", "directory", "root-dot"])
    }),
  )

  it.live("skips project config files when the flag is set", () =>
    Effect.gen(function* () {
      const result = yield* discover("true")

      // V1 skips ConfigPaths.files(...) entirely, leaving only global config.
      expect(result.documents).toEqual(["global"])
    }),
  )

  it.live("skips project .opencode directories when the flag is set", () =>
    Effect.gen(function* () {
      const result = yield* discover("true")

      expect(result.directories.some((item) => item.startsWith(result.projectRoot))).toBe(false)
    }),
  )

  it.live("still loads global config when the flag is set", () =>
    Effect.gen(function* () {
      const result = yield* discover("true")

      expect(result.documents).toContain("global")
      expect(result.directories).toContain(result.globalRoot)
    }),
  )

  it.live("accepts the value 1 as truthy", () =>
    Effect.gen(function* () {
      const result = yield* discover("1")

      expect(result.documents).toEqual(["global"])
    }),
  )

  it.live("treats an unrelated value as unset", () =>
    Effect.gen(function* () {
      const result = yield* discover("false")

      expect(result.documents).toEqual(["global", "root", "directory", "root-dot"])
    }),
  )
})
