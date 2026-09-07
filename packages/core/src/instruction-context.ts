export * as InstructionContext from "./instruction-context"

import { Array, Effect, Layer, Option, Schema } from "effect"
import { basename, dirname, isAbsolute, join, relative, sep } from "path"
import { Config } from "./config"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { makeLocationNode } from "./effect/app-node"

class File extends Schema.Class<File>("InstructionContext.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = SystemContext.Key.make("core/instructions")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    // Optional so this context still loads in runtimes assembled without Config,
    // mirroring ToolOutputStore's node / nodeWithoutConfig split.
    const config = yield* Effect.serviceOption(Config.Service)

    const source = (value: ReadonlyArray<File> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Files),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
        removed: () => "Previously loaded instructions no longer apply.",
      })

    /**
     * Resolves `config.instructions` entries to absolute instruction file paths.
     *
     * V1 parity (`packages/opencode/src/session/instruction.ts:135-150`): http(s) entries are
     * skipped because they are not filesystem paths, `~/` expands against the home directory,
     * absolute entries glob inside their own directory, and relative entries glob upward from
     * the working directory to the project boundary. Unmatched entries are dropped.
     */
    const configured = Effect.fn("InstructionContext.configured")(function* (start: string, stop: string) {
      if (Option.isNone(config)) return [] as string[]
      const entries = yield* config.value.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      const declared = entries.flatMap((entry) => (entry.type === "document" ? (entry.info.instructions ?? []) : []))
      const resolved: string[] = []
      for (const raw of declared) {
        if (raw.startsWith("https://") || raw.startsWith("http://")) continue
        const instruction = raw.startsWith("~/") ? join(global.home, raw.slice(2)) : raw
        const matches = yield* (
          isAbsolute(instruction)
            ? fs.glob(basename(instruction), { cwd: dirname(instruction), absolute: true, include: "file" })
            : fs.globUp(instruction, start, stop)
        ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
        resolved.push(...matches)
      }
      return yield* Effect.forEach(resolved, fs.resolve)
    })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const discovered = new Set(
        yield* Effect.forEach(
          Flag.OPENCODE_DISABLE_PROJECT_CONFIG || !insideProject
            ? []
            : yield* fs.up({
                targets: ["AGENTS.md"],
                start,
                stop,
              }),
          fs.resolve,
        ),
      )
      const paths = Array.dedupe([
        yield* fs.resolve(join(global.config, "AGENTS.md")),
        ...discovered,
        ...(insideProject ? yield* configured(start, stop) : []),
      ])
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(
              Effect.map((content) =>
                content === undefined ? undefined : new File({ path: AbsolutePath.make(path), content }),
              ),
            ),
        { concurrency: "unbounded" },
      )
      if (files.some((file, index) => file === undefined && discovered.has(paths[index])))
        return SystemContext.unavailable
      return files.filter((file): file is File => file !== undefined)
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((files) =>
          files === SystemContext.unavailable
            ? source(files)
            : files.length === 0
              ? SystemContext.empty
              : source(files),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [FSUtil.node, Global.node, Location.node, SystemContextRegistry.node, Config.node],
})

/** Variant for runtimes assembled without Config; `config.instructions` is then unavailable. */
export const nodeWithoutConfig = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [FSUtil.node, Global.node, Location.node, SystemContextRegistry.node],
})

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}
