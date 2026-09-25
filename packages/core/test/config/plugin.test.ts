import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigExternalPlugin } from "@opencode-ai/core/config/plugin/external"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Npm } from "@opencode-ai/core/npm"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

const fixture = (name: string) => path.join(import.meta.dir, "../plugin/fixtures", name)

function npmStub(entrypoints: Record<string, string | undefined>, onAdd?: (spec: string) => void) {
  return Npm.Service.of({
    add: (spec) =>
      Effect.sync(() => {
        onAdd?.(spec)
        return { directory: import.meta.dir, entrypoint: entrypoints[spec] }
      }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  })
}

describe("ConfigExternalPlugin", () => {
  it.live("resolves and loads a configured Promise plugin with options", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = npmStub({ "config-promise-plugin": fixture("config-promise-plugin.ts") })
      const host = yield* PluginHost.make(plugins)
      const document = path.join(import.meta.dir, "opencode.json")

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: document,
                  info: decode({
                    plugins: [
                      {
                        package: "config-promise-plugin",
                        options: { description: "Loaded from config" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Loaded from config",
        mode: "subagent",
      })
    }),
  )

  it.live("loads a configured Effect plugin with options", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = npmStub({ "config-effect-plugin": fixture("config-effect-plugin.ts") })
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opencode.json"),
                  info: decode({
                    plugins: [
                      {
                        package: "config-effect-plugin",
                        options: { description: "Effect plugin from config" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "effect-configured")).toMatchObject({
        description: "Effect plugin from config",
        mode: "subagent",
      })
    }),
  )

  it.live("ignores local plugin references and invalid packages and continues loading", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const installed: string[] = []
      const npm = npmStub(
        {
          "missing-plugin": undefined,
          "invalid-plugin": fixture("invalid-plugin.ts"),
          "config-promise-plugin": fixture("config-promise-plugin.ts"),
        },
        (spec) => installed.push(spec),
      )
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opencode.json"),
                  info: decode({
                    plugins: [
                      "../plugin/fixtures/config-promise-plugin.ts",
                      "file:///tmp/local-plugin.ts",
                      "missing-plugin",
                      "invalid-plugin",
                      {
                        package: "config-promise-plugin",
                        options: { description: "Loaded after invalid plugins" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Loaded after invalid plugins",
      })
      expect(installed).toEqual(["missing-plugin", "invalid-plugin", "config-promise-plugin"])
    }),
  )

  it.live("installs and resolves npm plugin packages", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const host = yield* PluginHost.make(plugins)
      let installed: string | undefined
      const npm = npmStub({ "example-plugin@1.0.0": fixture("config-promise-plugin.ts") }, (spec) => (installed = spec))

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: decode({
                    plugins: [
                      {
                        package: "example-plugin@1.0.0",
                        options: { description: "Installed from npm" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "configured")).toMatchObject({
        description: "Installed from npm",
      })
      expect(installed).toBe("example-plugin@1.0.0")
    }),
  )

  it.live("loads plugin files from config directories", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Directory({
                  type: "directory",
                  path: AbsolutePath.make(path.join(import.meta.dir, "fixtures")),
                }),
              ]),
          }),
        ),
      )

      expect(yield* waitForAgent(agents, "directory")).toMatchObject({
        description: "Loaded from plugin directory",
        mode: "subagent",
      })
    }),
  )
})

const waitForAgent = Effect.fnUntraced(function* (agents: AgentV2.Interface, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const agent = yield* agents.get(AgentV2.ID.make(id))
    if (agent) return agent
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die(`Timed out waiting for agent ${id}`)
})
