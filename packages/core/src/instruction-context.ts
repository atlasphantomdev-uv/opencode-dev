export * as InstructionContext from "./instruction-context"

import { Array, Effect, Layer, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { basename, dirname, isAbsolute, join, relative, sep } from "path"
import { Config } from "./config"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { makeLocationNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"

class File extends Schema.Class<File>("InstructionContext.File")({
  path: Schema.String,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = SystemContext.Key.make("core/instructions")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const config = yield* Config.Service
    const registry = yield* SystemContextRegistry.Service
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.retryTransient({
        retryOn: "errors-and-responses",
        times: 2,
        schedule: Schedule.exponential(200).pipe(Schedule.jittered),
      }),
      HttpClient.filterStatusOk,
    )

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

    const fetchRemote = Effect.fnUntraced(function* (url: string) {
      return yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.flatMap((response) => response.text),
        Effect.timeout(5000),
        Effect.catch(() => Effect.succeed("")),
      )
    })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const candidates =
        Flag.OPENCODE_DISABLE_PROJECT_CONFIG || !insideProject
          ? []
          : yield* fs.up({ targets: ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"], start, stop })
      const discovered = new Set(yield* Effect.forEach(candidates, fs.resolve))

      const configured = Config.latest(yield* config.entries(), "instructions") ?? []
      const remotes = configured.filter(isRemote)
      const configuredMatches = yield* Effect.forEach(
        configured.filter((item) => !isRemote(item)),
        (instruction) => {
          const target = instruction.startsWith("~/") ? join(global.home, instruction.slice(2)) : instruction
          return (
            isAbsolute(target)
              ? fs.glob(basename(target), { cwd: dirname(target), absolute: true, include: "file" })
              : Flag.OPENCODE_DISABLE_PROJECT_CONFIG
                ? fs.globUp(target, global.config, global.config)
                : fs.globUp(target, location.directory, location.project.directory)
          ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
        },
        { concurrency: "unbounded" },
      )

      const paths = Array.dedupe([
        yield* fs.resolve(join(global.config, "AGENTS.md")),
        yield* fs.resolve(join(global.home, ".claude", "CLAUDE.md")),
        ...discovered,
        ...(yield* Effect.forEach(configuredMatches.flat(), fs.resolve)),
      ])
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(Effect.map((content) => (content === undefined ? undefined : new File({ path, content })))),
        { concurrency: "unbounded" },
      )
      if (files.some((file, index) => file === undefined && discovered.has(paths[index])))
        return SystemContext.unavailable

      const localFiles = files.filter((file): file is File => file !== undefined)
      const remoteContents = yield* Effect.forEach(remotes, fetchRemote, { concurrency: 4 })
      const remoteFiles = remoteContents.flatMap((content, index) =>
        content === "" ? [] : [new File({ path: remotes[index], content })],
      )
      return [...localFiles, ...remoteFiles]
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
  deps: [FSUtil.node, Global.node, Location.node, Config.node, SystemContextRegistry.node, httpClient],
})

function isRemote(instruction: string) {
  return instruction.startsWith("https://") || instruction.startsWith("http://")
}

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}
