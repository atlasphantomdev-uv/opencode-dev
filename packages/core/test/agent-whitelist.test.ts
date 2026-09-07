import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Reference } from "@opencode-ai/core/reference"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { AgentWhitelistPlugin } from "@opencode-ai/core/plugin/agent-whitelist"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

const locationService = Effect.provideService(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)

/** Minimal SkillV2/Reference stubs: this suite only exercises the directories they expose. */
const stubs = (input: { readonly skills?: ReadonlyArray<string>; readonly references?: ReadonlyArray<string> }) =>
  Layer.mergeAll(
    Layer.succeed(
      SkillV2.Service,
      SkillV2.Service.of({
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
        sources: () => Effect.succeed([]),
        list: () =>
          Effect.succeed(
            (input.skills ?? []).map((location) =>
              SkillV2.Info.make({
                name: `skill-${location}`,
                description: "test skill",
                location: AbsolutePath.make(location),
                content: "body",
              }),
            ),
          ),
      }),
    ),
    Layer.succeed(
      Reference.Service,
      Reference.Service.of({
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
        list: () =>
          Effect.succeed(
            (input.references ?? []).map((path) =>
              Reference.Info.make({
                name: `ref-${path}`,
                path: AbsolutePath.make(path),
                source: { type: "local", path: AbsolutePath.make(path) },
              }),
            ),
          ),
      }),
    ),
  )

/** Runs the real AgentPlugin, then the whitelist plugin, and returns the build agent. */
const build = (input: { readonly skills?: ReadonlyArray<string>; readonly references?: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const agent = yield* AgentV2.Service
    const context = host({ agent: agentHost(agent) })
    yield* AgentPlugin.Plugin.effect(context).pipe(locationService)
    yield* AgentWhitelistPlugin.Plugin.effect(context).pipe(Effect.provide(stubs(input)), locationService)
    const all = yield* agent.all()
    return { agent, all, build: all.find((item) => String(item.id) === "build")! }
  })

const evaluate = (agent: AgentV2.Info, resource: string) =>
  PermissionV2.evaluate("external_directory", resource, agent.permissions).effect

describe("AgentWhitelistPlugin", () => {
  it.effect("allows a skill directory outside the worktree", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({ skills: ["/home/user/.config/opencode/skills/deploy/SKILL.md"] })

      // V1 whitelisted path.dirname(skillFile) as `<dir>/*`.
      expect(evaluate(agent, "/home/user/.config/opencode/skills/deploy/*")).toBe("allow")
    }),
  )

  it.effect("allows a reference directory", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({ references: ["/home/user/.local/share/opencode/refs/docs"] })

      expect(evaluate(agent, "/home/user/.local/share/opencode/refs/docs/*")).toBe("allow")
    }),
  )

  it.effect("keeps asking for unrelated external directories", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({ skills: ["/home/user/.config/opencode/skills/deploy/SKILL.md"] })

      // The broad V1 default must survive: only whitelisted directories are allowed.
      expect(evaluate(agent, "/etc/*")).toBe("ask")
      expect(evaluate(agent, "/home/user/secrets/*")).toBe("ask")
    }),
  )

  it.effect("preserves the AgentPlugin whitelist entries", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({ skills: ["/home/user/.config/opencode/skills/deploy/SKILL.md"] })

      expect(evaluate(agent, "/tmp/opencode/*")).toBe("allow")
    }),
  )

  it.effect("ignores built-in skills that have no real directory", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({ skills: ["/builtin/customize-opencode.md"] })

      expect(agent.permissions.some((rule) => String(rule.resource).startsWith("/builtin"))).toBe(false)
    }),
  )

  it.effect("applies the whitelist to every agent, not just build", () =>
    Effect.gen(function* () {
      const { all } = yield* build({ skills: ["/home/user/.config/opencode/skills/deploy/SKILL.md"] })

      expect(all.length).toBeGreaterThan(1)
      for (const agent of all) {
        expect(evaluate(agent, "/home/user/.config/opencode/skills/deploy/*")).toBe("allow")
      }
    }),
  )

  it.effect("adds no rules when there are no skill or reference directories", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({})

      const external = agent.permissions.filter((rule) => rule.action === "external_directory")
      // Only the two AgentPlugin defaults plus the broad ask remain.
      expect(external).toHaveLength(3)
      expect(evaluate(agent, "/home/user/.config/opencode/skills/deploy/*")).toBe("ask")
    }),
  )

  it.effect("deduplicates directories shared by several skills", () =>
    Effect.gen(function* () {
      const { build: agent } = yield* build({
        skills: ["/home/user/skills/a/SKILL.md", "/home/user/skills/a/b.md"],
      })

      const matching = agent.permissions.filter((rule) => rule.resource === "/home/user/skills/a/*")
      expect(matching).toHaveLength(1)
    }),
  )
})
