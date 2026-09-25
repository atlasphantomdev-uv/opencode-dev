import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Integration } from "@opencode-ai/core/integration"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { EnvPlugin } from "@opencode-ai/core/plugin/env"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const decodeConfig = Schema.decodeUnknownSync(Config.Info)
const decodeProvider = Schema.decodeUnknownSync(ModelsDev.Provider)

const models = (data: Record<string, ModelsDev.Provider>) =>
  ModelsDev.Service.of({ get: () => Effect.succeed(data), refresh: () => Effect.void })

const config = (entries: Config.Entry[]) => Config.Service.of({ entries: () => Effect.succeed(entries) })

const addPlugin = Effect.fn(function* (input: { models: ModelsDev.Interface; config: Config.Interface }) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* EnvPlugin.Plugin.effect(host).pipe(
    Effect.provideService(ModelsDev.Service, input.models),
    Effect.provideService(Config.Service, input.config),
  )
})

const document = (providers: Record<string, unknown>) =>
  new Config.Document({ type: "document", info: decodeConfig({ providers }) })

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

describe("EnvPlugin", () => {
  it.effect("registers env methods for models.dev and config providers and ignores missing env", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* addPlugin({
        models: models({
          acme: decodeProvider({ id: "acme", name: "Acme", env: ["ACME_API_KEY"], models: {} }),
          local: decodeProvider({ id: "local", name: "Local", env: [], models: {} }),
        }),
        config: config([document({ custom: { env: ["CUSTOM_API_KEY"] } })]),
      })

      expect((yield* integrations.get(Integration.ID.make("acme")))?.methods).toEqual([
        { type: "env", names: ["ACME_API_KEY"] },
      ])
      expect((yield* integrations.get(Integration.ID.make("custom")))?.methods).toEqual([
        { type: "env", names: ["CUSTOM_API_KEY"] },
      ])
      expect(yield* integrations.get(Integration.ID.make("local"))).toBeUndefined()
    }),
  )

  it.effect("applies config env over models.dev env without duplicate methods", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* addPlugin({
        models: models({
          acme: decodeProvider({ id: "acme", name: "Acme", env: ["MODELS_DEV_KEY"], models: {} }),
        }),
        config: config([document({ acme: { env: ["CONFIG_KEY"] } })]),
      })

      const methods = (yield* integrations.get(Integration.ID.make("acme")))?.methods
      expect(methods).toEqual([{ type: "env", names: ["CONFIG_KEY"] }])
    }),
  )

  it.effect("resolves env-derived connections only for present variables", () =>
    withEnv({ ACME_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        yield* addPlugin({
          models: models({
            acme: decodeProvider({ id: "acme", name: "Acme", env: ["ACME_API_KEY"], models: {} }),
          }),
          config: config([]),
        })

        expect((yield* integrations.get(Integration.ID.make("acme")))?.connections).toEqual([])
      }),
    ),
  )

  it.effect("resolves an env connection when the variable is present", () =>
    withEnv({ ACME_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        yield* addPlugin({
          models: models({
            acme: decodeProvider({ id: "acme", name: "Acme", env: ["ACME_API_KEY"], models: {} }),
          }),
          config: config([]),
        })

        expect((yield* integrations.get(Integration.ID.make("acme")))?.connections).toEqual([
          { type: "env", name: "ACME_API_KEY" },
        ])
      }),
    ),
  )
})
