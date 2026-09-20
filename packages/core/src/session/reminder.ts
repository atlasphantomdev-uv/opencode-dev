export * as SessionReminder from "./reminder"

import { Context, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SystemContext } from "../system-context/index"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"

/**
 * Model-visible plan/build reminders for the V2 runtime.
 *
 * V1 injects these reminders as synthetic parts on the last user message. V2 has no synthetic
 * message parts: its privileged model-visible text lives in System Context, so the reminder is
 * a refreshable source there while the reminder text stays byte-identical to V1's prompts.
 * `OPENCODE_EXPERIMENTAL_PLAN_MODE` semantics (plan file plus `plan_exit`) remain V1-only until
 * the V2 runtime owns a plan artifact.
 */
export interface Interface {
  readonly load: (input: {
    readonly agent: AgentV2.Selection
    readonly sessionID: SessionSchema.ID
  }) => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionReminder") {}

const planAgent = AgentV2.ID.make("plan")
const buildAgent = AgentV2.ID.make("build")
const key = SystemContext.Key.make("core/session-reminder")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service

    const text = (input: { readonly agent: AgentV2.Selection; readonly planned: boolean }) => {
      if (input.agent.id === planAgent) return PROMPT_PLAN
      if (input.agent.id === buildAgent && input.planned) return BUILD_SWITCH
      return undefined
    }

    return Service.of({
      load: Effect.fn("SessionReminder.load")(function* (input) {
        // Unreadable history is the runner's failure to report; the reminder itself stays optional.
        const messages = yield* store
          .context(input.sessionID)
          .pipe(Effect.catchTag("Session.MessageDecodeError", () => Effect.succeed([])))
        const value = text({
          agent: input.agent,
          planned: messages.some((message) => message.type === "assistant" && message.agent === "plan"),
        })
        if (value === undefined) return SystemContext.empty
        return SystemContext.make({
          key,
          codec: Schema.toCodecJson(Schema.String),
          load: Effect.succeed(value),
          baseline: (current) => current,
          update: (_previous, current) =>
            ["The session mode reminder has changed. Follow the current reminder.", current].join("\n\n"),
          removed: () => "The session mode reminder no longer applies.",
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [SessionStore.node] })
