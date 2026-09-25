export * as EnvPlugin from "./env"

import { define } from "./internal"
import { Effect } from "effect"
import { Config } from "../config"
import { ModelsDev } from "../models-dev"

export const Plugin = define({
  id: "env",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const modelsDev = yield* ModelsDev.Service
    yield* ctx.integration.transform(
      Effect.fn(function* (integrations) {
        const data = yield* modelsDev.get()
        for (const item of Object.values(data)) {
          if (item.env.length === 0) continue
          integrations.method.update({
            integrationID: item.id,
            method: { type: "env", names: [...item.env] },
          })
        }
        const files = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            if (item.env === undefined) continue
            integrations.method.update({
              integrationID: id,
              method: { type: "env", names: [...item.env] },
            })
          }
        }
      }),
    )
  }),
})
