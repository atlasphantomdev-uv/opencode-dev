import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Logger } from "effect"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Config } from "../../src/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { provideInstance, provideTmpdirInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import fs from "fs/promises"

const node = LayerNode.compile(CrossSpawnSpawner.node)

const it = testEffect(Layer.mergeAll(LayerNode.compile(Skill.node), node, testInstanceStoreLayer))
const itWithoutClaudeCodeSkills = testEffect(
  Layer.mergeAll(
    LayerNode.compile(Skill.node, [[RuntimeFlags.node, RuntimeFlags.layer({ disableClaudeCodeSkills: true })]]),
    node,
    testInstanceStoreLayer,
  ),
)
const itWithoutExternalSkills = testEffect(
  Layer.mergeAll(
    LayerNode.compile(Skill.node, [[RuntimeFlags.node, RuntimeFlags.layer({ disableExternalSkills: true })]]),
    node,
    testInstanceStoreLayer,
  ),
)

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

const withTmpHome = <A, E, R>(
  options: { git?: boolean; config?: Partial<ConfigV1.Info> },
  body: (home: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir(options)),
      (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
    )
    return yield* withHome(tmp.path, body(tmp.path).pipe(provideInstance(tmp.path)))
  })

const skillMd = (name: string, description?: string, extra = "") =>
  `---\nname: ${name}\n${description === undefined ? "" : `description: ${description}\n`}---\n\n# ${name}\n\n${extra}`

// Writes `<root>/<name>/SKILL.md` and returns the skill directory.
async function writeSkill(root: string, name: string, body?: string) {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, "SKILL.md"), body ?? skillMd(name, "A test skill."))
  return dir
}

// Captures emitted log messages so duplicate warnings can be asserted.
function captureLogs<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const messages: unknown[] = []
  return effect
    .pipe(
      Effect.provide(
        Logger.layer([
          Logger.make<unknown, void>((options) => {
            messages.push(options.message)
          }),
        ]),
      ),
    )
    .pipe(Effect.map((result) => ({ result, messages })))
}

const duplicates = (messages: unknown[]) =>
  messages.filter(
    (item): item is [string, Record<string, unknown>] => Array.isArray(item) && item[0] === "duplicate skill name",
  )

// Discovery is replaced so remote (`skills.urls`) resolution is deterministic
// and offline; the pull result is driven by `remoteDirs`.
const remoteDirs: string[] = []
const mockDiscoveryLayer = Layer.succeed(
  Discovery.Service,
  Discovery.Service.of({ pull: () => Effect.succeed(remoteDirs) }),
)
const itWithRemoteSkills = testEffect(
  Layer.mergeAll(LayerNode.compile(Skill.node, [[Discovery.node, mockDiscoveryLayer]]), node, testInstanceStoreLayer),
)

describe("skill", () => {
  it.effect("formats verbose locations as XML-safe filesystem paths", () =>
    Effect.sync(() => {
      const output = Skill.fmt(
        [
          {
            name: "tagged-skill",
            description: "A tagged skill.",
            location: "/tmp/plugin.git#v1.3.0/SKILL.md",
            content: "",
          },
          {
            name: "built-in-skill",
            description: "A built-in skill.",
            location: "<built-in>",
            content: "",
          },
        ],
        { verbose: true },
      )

      expect(output).toContain("<location>/tmp/plugin.git#v1.3.0/SKILL.md</location>")
      expect(output).toContain("<location>&lt;built-in&gt;</location>")
      expect(output).not.toContain("file://")
      expect(output).not.toContain("%23")
    }),
  )

  it.live("discovers skills from .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "test-skill", "SKILL.md"),
              `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "test-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A test skill for verification.")
          expect(item!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("returns skill directories from Skill.dirs", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              Bun.write(
                path.join(dir, ".opencode", "skill", "dir-skill", "SKILL.md"),
                `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
              ),
            )

            const skill = yield* Skill.Service
            const dirs = yield* skill.dirs()
            expect(dirs).toContain(path.join(dir, ".opencode", "skill", "dir-skill"))
            expect(dirs.length).toBe(1)
          }),
        ),
      { git: true },
    ),
  )

  it.live("discovers multiple skills from .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skill", "skill-one", "SKILL.md"),
                `---
name: skill-one
description: First test skill.
---

# Skill One
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "skill-two", "SKILL.md"),
                `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "skill-one")).toBeDefined()
          expect(list.find((x) => x.name === "skill-two")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skips skills with missing frontmatter", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "no-frontmatter", "SKILL.md"),
              `# No Frontmatter

Just some content without YAML frontmatter.
`,
            ),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.all()).filter((s) => s.location !== "<built-in>")).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers skills without descriptions", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "manual-skill", "SKILL.md"),
              `---
name: manual-skill
---

# Manual Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "manual-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBeUndefined()
          expect(Skill.fmt(list, { verbose: false })).toBe("No skills are currently available.")
          expect(Skill.fmt(list, { verbose: true })).toBe("No skills are currently available.")
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .claude/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
              `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "claude-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.claude/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          yield* Effect.promise(() => createGlobalSkill(tmp.path))
          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("global-test-skill")
            expect(list[0].description).toBe("A global skill from ~/.claude/skills for testing.")
            expect(list[0].location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("returns empty array when no skills exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          expect((yield* skill.all()).filter((s) => s.location !== "<built-in>")).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("fails with typed error when requiring a missing skill", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const error = yield* Effect.flip(skill.require("missing-skill"))
          expect(error).toBeInstanceOf(Skill.NotFoundError)
          expect(error._tag).toBe("Skill.NotFoundError")
          expect(error.name).toBe("missing-skill")
          expect(error.message).toContain('Skill "missing-skill" not found.')
        }),
      { git: true },
    ),
  )

  it.effect("exposes tagged expected skill failure classes", () =>
    Effect.sync(() => {
      const invalid = new Skill.InvalidError({ path: "/tmp/SKILL.md", message: "Invalid skill frontmatter" })
      const mismatch = new Skill.NameMismatchError({
        path: "/tmp/SKILL.md",
        expected: "expected-skill",
        actual: "actual-skill",
      })

      expect(invalid).toBeInstanceOf(Skill.InvalidError)
      expect(invalid._tag).toBe("SkillInvalidError")
      expect(mismatch).toBeInstanceOf(Skill.NameMismatchError)
      expect(mismatch._tag).toBe("SkillNameMismatchError")
    }),
  )

  it.live("discovers skills from .agents/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
              `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "agent-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.agents/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
          yield* Effect.promise(() => fs.mkdir(skillDir, { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skillDir, "SKILL.md"),
              `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
            ),
          )

          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("global-agent-skill")
            expect(list[0].description).toBe("A global skill from ~/.agents/skills for testing.")
            expect(list[0].location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("discovers skills from both .claude/skills/ and .agents/skills/", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "claude-skill")).toBeDefined()
          expect(list.find((x) => x.name === "agent-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )

  itWithoutClaudeCodeSkills.live("skips Claude Code skills when disabled", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.map((s) => s.name)).toEqual(["agent-skill"])
        }),
      { git: true },
    ),
  )

  itWithoutExternalSkills.live("skips external skill directories when disabled", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "opencode-skill", "SKILL.md"),
                `---
name: opencode-skill
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.map((s) => s.name)).toEqual(["opencode-skill"])
        }),
      { git: true },
    ),
  )

  it.live("properly resolves directories that skills live in", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "agent-skill", "SKILL.md"),
                `---
name: opencode-skill
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "agent-skill", "SKILL.md"),
                `---
name: opencode-skill
description: A skill in the .opencode/skills directory.
---

# OpenCode Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.dirs()).length).toBe(4)
        }),
      { git: true },
    ),
  )

  it.live("deduplicates identical absolute skill paths without warning", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            yield* Effect.promise(() => writeSkill(path.join(dir, ".claude", "skills"), "dedup-skill"))

            const skill = yield* Skill.Service
            const { result, messages } = yield* captureLogs(skill.all())
            const list = result.filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("dedup-skill")
            expect(duplicates(messages)).toEqual([])
          }),
        ),
      { git: true, config: { skills: { paths: ["~/.claude/skills"] } } },
    ),
  )

  it.live("resolves duplicate global external skills deterministically", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            // The lower-priority (.claude) file is deliberately large so its parse
            // finishes last; the deterministic merge must still pick .agents.
            yield* Effect.promise(() =>
              writeSkill(
                path.join(dir, ".claude", "skills"),
                "shared-global",
                skillMd("shared-global", "claude variant.", "padding ".repeat(8000)),
              ),
            )
            yield* Effect.promise(() => writeSkill(path.join(dir, ".agents", "skills"), "shared-global"))

            const skill = yield* Skill.Service
            const { result, messages } = yield* captureLogs(skill.all())
            const list = result.filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].location).toContain(path.join(".agents", "skills", "shared-global"))

            const warnings = duplicates(messages)
            expect(warnings.length).toBe(1)
            expect(warnings[0][1].name).toBe("shared-global")
            expect(warnings[0][1].winner).toContain(path.join(".agents", "skills"))
            expect(warnings[0][1].ignored).toContain(path.join(".claude", "skills"))
          }),
        ),
      { git: true },
    ),
  )

  it.live("duplicate winner is independent of parse completion order", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            // Inverse of the previous test: the winning (.agents) file is large and
            // finishes last-parse-first; winner must be unchanged.
            yield* Effect.promise(() => writeSkill(path.join(dir, ".claude", "skills"), "shared-timing"))
            yield* Effect.promise(() =>
              writeSkill(
                path.join(dir, ".agents", "skills"),
                "shared-timing",
                skillMd("shared-timing", "agents variant.", "padding ".repeat(8000)),
              ),
            )

            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].location).toContain(path.join(".agents", "skills", "shared-timing"))
          }),
        ),
      { git: true },
    ),
  )

  it.live("project-local skill overrides global external skill with same name", () =>
    withTmpHome({ git: true }, (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeSkill(path.join(dir, ".claude", "skills"), "shared-scope"))
        yield* Effect.promise(() => writeSkill(path.join(dir, ".opencode", "skills"), "shared-scope"))

        const skill = yield* Skill.Service
        const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
        expect(list.length).toBe(1)
        expect(list[0].location).toContain(path.join(".opencode", "skills", "shared-scope"))
      }),
    ),
  )

  it.live("opencode config skill overrides companion compatibility skill", () =>
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const project = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )

      yield* withHome(
        home.path,
        Effect.gen(function* () {
          yield* Effect.promise(() => writeSkill(path.join(project.path, ".claude", "skills"), "shared-compat"))
          yield* Effect.promise(() => writeSkill(path.join(project.path, ".opencode", "skills"), "shared-compat"))

          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].location).toContain(path.join(".opencode", "skills", "shared-compat"))
          }).pipe(provideInstance(project.path))
        }),
      )
    }),
  )

  it.live("skills.paths deterministically overrides config directory skill with same name", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => writeSkill(path.join(dir, ".opencode", "skills"), "shared-paths"))
          yield* Effect.promise(() => writeSkill(path.join(dir, "extra-skills"), "shared-paths"))

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          expect(list[0].location).toContain(path.join("extra-skills", "shared-paths", "SKILL.md"))
        }),
      { git: true, config: { skills: { paths: ["extra-skills"] } } },
    ),
  )

  itWithRemoteSkills.live("remote skills deterministically override local skills with same name", () =>
    Effect.gen(function* () {
      const project = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true, config: { skills: { urls: ["https://example.com/skills/"] } } })),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const remote = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )

      remoteDirs.length = 0
      remoteDirs.push(yield* Effect.promise(() => writeSkill(remote.path, "shared-remote")))

      yield* Effect.gen(function* () {
        yield* Effect.promise(() => writeSkill(path.join(project.path, ".opencode", "skills"), "shared-remote"))

        const skill = yield* Skill.Service
        const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
        expect(list.length).toBe(1)
        expect(list[0].location.startsWith(remote.path)).toBe(true)
      }).pipe(provideInstance(project.path))
    }),
  )

  it.live("disk skill deterministically overrides built-in customize-opencode", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => writeSkill(path.join(dir, ".opencode", "skills"), "customize-opencode"))

          const skill = yield* Skill.Service
          const { result, messages } = yield* captureLogs(skill.all())
          const builtin = result.find((s) => s.name === "customize-opencode")
          expect(builtin).toBeDefined()
          expect(builtin!.location).toContain(path.join(".opencode", "skills", "customize-opencode"))

          const warnings = duplicates(messages)
          expect(warnings.length).toBe(1)
          expect(warnings[0][1].ignored).toBe("<built-in>")
          expect(warnings[0][1].winner).toContain(path.join(".opencode", "skills", "customize-opencode"))
        }),
      { git: true },
    ),
  )

  it.live("malformed duplicate does not suppress a valid skill", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => writeSkill(path.join(dir, ".opencode", "skills"), "shared-malformed"))
          // Invalid frontmatter (description is not a string) in a later-priority
          // source; it must be skipped, never overwrite the valid skill.
          yield* Effect.promise(() =>
            writeSkill(
              path.join(dir, "extra"),
              "shared-malformed",
              `---\nname: shared-malformed\ndescription: 123\n---\n\n# broken\n`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          expect(list[0].location).toContain(path.join(".opencode", "skills", "shared-malformed"))
        }),
      { git: true, config: { skills: { paths: ["extra"] } } },
    ),
  )
})
