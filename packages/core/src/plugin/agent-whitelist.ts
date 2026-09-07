export * as AgentWhitelistPlugin from "./agent-whitelist"

import { define } from "./internal"
import path from "path"
import { Effect } from "effect"
import { PermissionV2 } from "../permission"
import { Reference } from "../reference"
import { SkillV2 } from "../skill"

/**
 * Whitelist skill and reference directories for `external_directory`.
 *
 * V1 parity (`packages/opencode/src/agent/agent.ts:108-117`) built the agent `external_directory`
 * whitelist from four sources: the truncation glob, the global tmp directory, every discovered
 * skill directory, and every configured reference directory. `AgentPlugin` only covers the first
 * two, because skill and reference sources are contributed by plugins that run *after* it
 * (`plugin/internal.ts`: `AgentPlugin` is added before `SkillPlugin`, `ConfigSkillPlugin`, and the
 * reference materialization). Registering these rules from `AgentPlugin` would therefore observe an
 * empty source list.
 *
 * This plugin runs last and appends the remaining allow-rules. `PermissionV2.evaluate` uses
 * `findLast`, so appending is sufficient to override the broad `external_directory: "*" -> ask`
 * default without reordering or rewriting any existing rule.
 *
 * V1 semantics preserved:
 * - a skill directory is `path.dirname(skillFile)` (V1 `skill/index.ts:133`), globbed as `dir/*`
 * - a reference directory is the reference `path` (V1 used `reference.list().map(r => r.path)`)
 * - rules are added to every agent, matching V1 folding the whitelist into shared `defaults`
 */
export const Plugin = define({
  id: "agent-whitelist",
  effect: Effect.fn(function* (ctx) {
    const skills = yield* SkillV2.Service
    const references = yield* Reference.Service

    // Built-in skills use a synthetic `/builtin/...` location and have no real directory.
    const skillDirs = (yield* skills.list())
      .map((skill) => path.dirname(skill.location))
      .filter((dir) => path.isAbsolute(dir) && !dir.startsWith(path.sep + "builtin"))
    const referenceDirs = (yield* references.list()).map((reference) => reference.path)

    const dirs = Array.from(new Set([...skillDirs, ...referenceDirs]))
    if (dirs.length === 0) return

    const rules = dirs.map(
      (dir): PermissionV2.Rule => ({
        action: "external_directory",
        resource: path.join(dir, "*"),
        effect: "allow",
      }),
    )

    yield* ctx.agent.transform((draft) => {
      for (const current of draft.list()) {
        draft.update(current.id, (agent) => agent.permissions.push(...rules))
      }
    })
  }),
})
