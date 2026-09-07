import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { Location } from "@opencode-ai/core/location"
import { Policy } from "@opencode-ai/core/policy"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

/**
 * V1 parity reference: `packages/opencode/src/session/instruction.ts:135-150`.
 * `config.instructions` entries are resolved into the ambient system prompt:
 * absolute paths glob within their own directory, relative patterns glob upward
 * from the working directory to the project boundary, `~/` expands to the home
 * directory, and http(s) URLs are skipped by path resolution.
 */
const baseline = (input: {
  readonly setup: (paths: { tmp: string; global: string; project: string; directory: string }) => Promise<void>
  readonly directory?: (paths: { project: string }) => string
}) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((tmp) =>
      Effect.gen(function* () {
        const global = path.join(tmp.path, "global")
        const project = path.join(tmp.path, "project")
        const directory = input.directory ? input.directory({ project }) : project
        yield* Effect.promise(async () => {
          await fs.mkdir(global, { recursive: true })
          await fs.mkdir(directory, { recursive: true })
          await fs.writeFile(path.join(global, "AGENTS.md"), "global")
          await input.setup({ tmp: tmp.path, global, project, directory })
        })

        const load = SystemContextRegistry.Service.pipe(
          Effect.flatMap((service) => service.load()),
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([SystemContextRegistry.node, InstructionContext.node, Config.node, Policy.node]),
              [
                [Global.node, Global.layerWith({ config: global })],
                [
                  Location.node,
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location(
                        { directory: AbsolutePath.make(directory) },
                        { projectDirectory: AbsolutePath.make(project) },
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        )

        return (yield* SystemContext.initialize(yield* load)).baseline
      }),
    ),
  )

describe("InstructionContext config.instructions", () => {
  it.live("loads a relative instruction file declared in config", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        setup: async ({ project }) => {
          await fs.writeFile(path.join(project, "CONTRIBUTING.md"), "contributing-content")
          await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ instructions: ["CONTRIBUTING.md"] }))
        },
      })

      expect(text).toContain("contributing-content")
      // The ambient AGENTS.md context must still be present.
      expect(text).toContain("global")
    }),
  )

  it.live("expands glob patterns in config instructions", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        setup: async ({ project }) => {
          await fs.mkdir(path.join(project, "docs"), { recursive: true })
          await fs.writeFile(path.join(project, "docs", "one.md"), "doc-one")
          await fs.writeFile(path.join(project, "docs", "two.md"), "doc-two")
          await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ instructions: ["docs/*.md"] }))
        },
      })

      expect(text).toContain("doc-one")
      expect(text).toContain("doc-two")
    }),
  )

  it.live("loads an absolute instruction path", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        setup: async ({ tmp, project }) => {
          const external = path.join(tmp, "external.md")
          await fs.writeFile(external, "external-content")
          await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ instructions: [external] }))
        },
      })

      expect(text).toContain("external-content")
    }),
  )

  it.live("resolves relative patterns upward to the project boundary", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        directory: ({ project }) => path.join(project, "packages", "app"),
        setup: async ({ project }) => {
          await fs.writeFile(path.join(project, "RULES.md"), "root-rules")
          await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ instructions: ["RULES.md"] }))
        },
      })

      expect(text).toContain("root-rules")
    }),
  )

  it.live("ignores http and https instruction entries during path resolution", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        setup: async ({ project }) => {
          await fs.writeFile(path.join(project, "LOCAL.md"), "local-content")
          await fs.writeFile(
            path.join(project, "opencode.json"),
            JSON.stringify({ instructions: ["https://example.com/remote.md", "LOCAL.md"] }),
          )
        },
      })

      expect(text).toContain("local-content")
      expect(text).not.toContain("https://example.com/remote.md")
    }),
  )

  it.live("ignores instruction entries that match no file", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        setup: async ({ project }) => {
          await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ instructions: ["missing/*.md"] }))
        },
      })

      // Missing matches must not break the ambient context.
      expect(text).toContain("global")
    }),
  )

  it.live("keeps AGENTS.md discovery unchanged when no instructions are configured", () =>
    Effect.gen(function* () {
      const text = yield* baseline({
        setup: async ({ project }) => {
          await fs.writeFile(path.join(project, "AGENTS.md"), "project-agents")
        },
      })

      expect(text).toContain("global")
      expect(text).toContain("project-agents")
    }),
  )
})
