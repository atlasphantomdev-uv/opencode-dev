import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import fs from "fs/promises"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const instructionLayer = (input: {
  config: string
  locationServiceLayer: Layer.Layer<Location.Service>
  filesystemLayer?: Layer.Layer<FSUtil.Service>
  instructions?: string[]
  home?: string
  httpLayer?: Layer.Layer<HttpClient.HttpClient>
}) => {
  const instructions = input.instructions ?? []
  const configLayer = Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed(
          instructions.length === 0
            ? []
            : [new Config.Document({ type: "document", info: new Config.Info({ instructions }) })],
        ),
    }),
  )
  return AppNodeBuilder.build(LayerNode.group([SystemContextRegistry.node, InstructionContext.node]), [
    [Global.node, Global.layerWith({ config: input.config, ...(input.home ? { home: input.home } : {}) })],
    [Location.node, input.locationServiceLayer],
    [Config.node, configLayer],
    ...(input.filesystemLayer ? [[FSUtil.node, input.filesystemLayer] as const] : []),
    ...(input.httpLayer ? [[LayerNodePlatform.httpClient, input.httpLayer] as const] : []),
  ])
}

const locationAt = (directory: string, projectDirectory = directory) =>
  Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(projectDirectory) }),
    ),
  )

const mockHttp = (respond: (url: string) => Response | undefined) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => respond(request.url)).pipe(
        Effect.map((response) =>
          HttpClientResponse.fromWeb(request, response ?? new Response("Not Found", { status: 404 })),
        ),
      ),
    ),
  )

const loadBaseline = (layer: Layer.Layer<SystemContextRegistry.Service>) =>
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((service) => service.load()),
    Effect.flatMap((context) => SystemContext.initialize(context)),
    Effect.map((generation) => generation.baseline),
    Effect.provide(layer),
  )

describe("InstructionContext", () => {
  it.live("loads CLAUDE.md fallback", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "src")
          const claude = path.join(project, "CLAUDE.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(claude, "claude")
          })
          const context = yield* SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: path.join(tmp.path, "global"),
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )
          expect((yield* SystemContext.initialize(context)).baseline).toContain(`Instructions from: ${claude}\nclaude`)
        }),
      ),
    ),
  )

  it.live("loads CONTEXT.md fallback", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "src")
          const contextFile = path.join(project, "CONTEXT.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(contextFile, "context")
          })
          const context = yield* SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: path.join(tmp.path, "global"),
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )
          expect((yield* SystemContext.initialize(context)).baseline).toContain(
            `Instructions from: ${contextFile}\ncontext`,
          )
        }),
      ),
    ),
  )

  it.live("loads global and upward project AGENTS.md files as one aggregate context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "packages", "core")
          const outside = path.join(tmp.path, "AGENTS.md")
          const globalFile = path.join(global, "AGENTS.md")
          const projectFile = path.join(project, "AGENTS.md")
          const packageFile = path.join(directory, "AGENTS.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(outside, "outside")
            await fs.writeFile(globalFile, "global")
            await fs.writeFile(projectFile, "project")
            await fs.writeFile(packageFile, "package")
          })

          const load = SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: global,
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )

          const initialized = yield* SystemContext.initialize(yield* load)
          expect(initialized.baseline).toBe(
            [
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${packageFile}\npackage`,
              `Instructions from: ${projectFile}\nproject`,
            ].join("\n\n"),
          )
          expect(initialized.baseline).not.toContain("outside")

          yield* Effect.promise(() => fs.writeFile(packageFile, "changed"))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toMatchObject({
            _tag: "Updated",
            text: expect.stringContaining(`Instructions from: ${packageFile}\nchanged`),
          })

          yield* Effect.promise(() => fs.rm(packageFile))
          const partial = yield* SystemContext.reconcile(yield* load, initialized.snapshot)
          expect(partial).toEqual({
            _tag: "Updated",
            text: [
              "These instructions replace all previously loaded ambient instructions.",
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${projectFile}\nproject`,
            ].join("\n\n"),
            snapshot: expect.any(Object),
          })

          yield* Effect.promise(() => Promise.all([fs.rm(globalFile), fs.rm(projectFile)]))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({
            _tag: "Updated",
            text: "Previously loaded instructions no longer apply.",
            snapshot: {},
          })
        }),
      ),
    ),
  )

  it.live("keeps an empty AGENTS.md as available context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "AGENTS.md")
          yield* Effect.promise(() => fs.writeFile(file, ""))
          const context = yield* SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: path.join(tmp.path, "global"),
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
                ),
              }),
            ),
          )

          expect((yield* SystemContext.initialize(context)).baseline).toBe(`Instructions from: ${file}\n`)
        }),
      ),
    ),
  )

  it.effect("preserves admitted instructions while observation is unavailable", () =>
    Effect.gen(function* () {
      const failingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({ ...fs, up: () => Effect.fail(new FSUtil.FileSystemError({ method: "up" })) }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: failingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/instructions": {
            value: [{ path: "/repo/AGENTS.md", content: "old" }],
            removed: "Previously loaded instructions no longer apply.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("preserves admitted instructions when a discovered file disappears before read", () =>
    Effect.gen(function* () {
      const file = AbsolutePath.make("/repo/AGENTS.md")
      const racingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: () => Effect.succeed([file]),
              readFileStringSafe: () => Effect.succeed(undefined),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: racingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/instructions": {
            value: [{ path: file, content: "old" }],
            removed: "Previously loaded instructions no longer apply.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("canonicalizes upward discovery boundaries", () =>
    Effect.gen(function* () {
      let observed: { targets: string[]; start: string; stop?: string } | undefined
      const observingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: (options) =>
                Effect.sync(() => {
                  observed = options
                  return []
                }),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: observingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make("/repo/") }, { projectDirectory: AbsolutePath.make("/repo") }),
              ),
            ),
          }),
        ),
      )

      expect(observed).toEqual({
        targets: ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"],
        start: FSUtil.resolve("/repo"),
        stop: FSUtil.resolve("/repo"),
      })
    }),
  )

  it.effect("honors the project instruction opt-out", () =>
    Effect.gen(function* () {
      const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      let scanned = false
      process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"

      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: Layer.effect(
              FSUtil.Service,
              FSUtil.Service.pipe(
                Effect.map((fs) => FSUtil.Service.of({ ...fs, up: () => Effect.sync(() => ((scanned = true), [])) })),
              ),
            ).pipe(Layer.provide(LayerNode.compile(FSUtil.node))),
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
            else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
          }),
        ),
      )

      expect(scanned).toBe(false)
    }),
  )

  it.effect("does not discover project instructions outside the canonical project root", () =>
    Effect.gen(function* () {
      let scanned = false
      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: Layer.effect(
              FSUtil.Service,
              FSUtil.Service.pipe(
                Effect.map((fs) => FSUtil.Service.of({ ...fs, up: () => Effect.sync(() => ((scanned = true), [])) })),
              ),
            ).pipe(Layer.provide(LayerNode.compile(FSUtil.node))),
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location(
                  { directory: AbsolutePath.make("/outside") },
                  { projectDirectory: AbsolutePath.make("/repo") },
                ),
              ),
            ),
          }),
        ),
      )

      expect(scanned).toBe(false)
    }),
  )

  it.live("loads configured relative instruction globs upward from the session directory", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "src")
          const docs = path.join(project, "docs")
          const outside = path.join(tmp.path, "docs", "outside.md")
          const relative = path.join(docs, "relative.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(directory, { recursive: true })
            await fs.mkdir(docs, { recursive: true })
            await fs.mkdir(path.dirname(outside), { recursive: true })
            await fs.writeFile(relative, "relative")
            await fs.writeFile(outside, "outside")
          })
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              instructions: ["docs/*.md"],
              locationServiceLayer: locationAt(directory, project),
            }),
          )
          expect(baseline).toContain(`Instructions from: ${relative}\nrelative`)
          expect(baseline).not.toContain("outside")
        }),
      ),
    ),
  )

  it.live("expands ~ against the global home directory", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const home = path.join(tmp.path, "home")
          const project = path.join(tmp.path, "project")
          const file = path.join(home, "team", "rules.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(file, "home-rules")
          })
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              home,
              instructions: ["~/team/rules.md"],
              locationServiceLayer: locationAt(project),
            }),
          )
          expect(baseline).toContain(`Instructions from: ${file}\nhome-rules`)
        }),
      ),
    ),
  )

  it.live("loads an absolute configured instruction path", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const file = path.join(tmp.path, "abs", "rules.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(file, "absolute")
          })
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              instructions: [file],
              locationServiceLayer: locationAt(project),
            }),
          )
          expect(baseline).toContain(`Instructions from: ${file}\nabsolute`)
        }),
      ),
    ),
  )

  it.live("orders discovered, then configured local, then fetched remote instructions", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const discovered = path.join(project, "AGENTS.md")
          const configured = path.join(tmp.path, "extra.md")
          const url = "https://example.test/rules.md"
          yield* Effect.promise(async () => {
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(discovered, "discovered")
            await fs.writeFile(configured, "local")
          })
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              instructions: [configured, url],
              locationServiceLayer: locationAt(project),
              httpLayer: mockHttp((requested) =>
                requested === url ? new Response("remote", { status: 200 }) : undefined,
              ),
            }),
          )
          expect(baseline).toBe(
            [
              `Instructions from: ${discovered}\ndiscovered`,
              `Instructions from: ${configured}\nlocal`,
              `Instructions from: ${url}\nremote`,
            ].join("\n\n"),
          )
        }),
      ),
    ),
  )

  it.live("dedupes resolved configured instruction paths", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const file = path.join(tmp.path, "extra.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(file, "once")
          })
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              instructions: [file, file],
              locationServiceLayer: locationAt(project),
            }),
          )
          expect(baseline.split(`Instructions from: ${file}`).length - 1).toBe(1)
        }),
      ),
    ),
  )

  it.live("skips remote instructions that fail or are empty", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const missing = "https://example.test/missing.md"
          const empty = "https://example.test/empty.md"
          const ok = "https://example.test/ok.md"
          yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              instructions: [missing, empty, ok],
              locationServiceLayer: locationAt(project),
              httpLayer: mockHttp((requested) => {
                if (requested === missing) return new Response("Not Found", { status: 404 })
                if (requested === empty) return new Response("", { status: 200 })
                if (requested === ok) return new Response("ok", { status: 200 })
                return undefined
              }),
            }),
          )
          expect(baseline).toBe(`Instructions from: ${ok}\nok`)
          expect(baseline).not.toContain(missing)
          expect(baseline).not.toContain(empty)
        }),
      ),
    ),
  )

  it.live("resolves configured relative instructions from the global config dir when project config is disabled", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
          process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
              else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
            }),
          )
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          const globalRules = path.join(global, "rules.md")
          const projectRules = path.join(project, "rules.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(project, { recursive: true })
            await fs.writeFile(globalRules, "global-rules")
            await fs.writeFile(projectRules, "project-rules")
          })
          const baseline = yield* loadBaseline(
            instructionLayer({
              config: global,
              instructions: ["rules.md"],
              locationServiceLayer: locationAt(project),
            }),
          )
          expect(baseline).toContain(`Instructions from: ${globalRules}\nglobal-rules`)
          expect(baseline).not.toContain("project-rules")
        }),
      ),
    ),
  )
})
