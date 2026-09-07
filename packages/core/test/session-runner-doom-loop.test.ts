import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { DoomLoop } from "@opencode-ai/core/tool/doom-loop"
import { Tool } from "@opencode-ai/core/tool/tool"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Location } from "@opencode-ai/core/location"
import { Cause, Effect, Layer, Schema, Stream } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const requests: LLMRequest[] = []
let responses: LLMEvent[][] = []
const executions: string[] = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const models = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({ resolve: () => Effect.succeed(model) }),
)
const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const systemContext = Layer.mock(SystemContextRegistry.Service, {
  register: () => Effect.void,
  load: () => Effect.succeed(SystemContext.empty),
})
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)

const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) => Effect.sync(() => executions.push(text)).pipe(Effect.as({ text })),
      }),
      other: Tool.make({
        description: "Other tool",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) => Effect.sync(() => executions.push(`other:${text}`)).pipe(Effect.as({ text })),
      }),
    }),
  ),
)
const echoNode = makeLocationNode({ name: "test/doom-loop-tools", layer: echo, deps: [ToolRegistry.node] })

const runnerNodes = LayerNode.group([
  Database.node,
  EventV2.node,
  QuestionV2.node,
  SessionProjector.node,
  SessionStore.node,
  PermissionSaved.node,
  PermissionV2.node,
  ApplicationTools.node,
  AgentV2.node,
  ToolRegistry.node,
  ToolRegistry.toolsNode,
  echoNode,
  SessionRunnerModel.node,
  SystemContextRegistry.node,
  SkillGuidance.node,
  ReferenceGuidance.node,
  Config.node,
  Snapshot.node,
  SessionRunnerLLM.node,
])

const overrides = [
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, current],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [Snapshot.node, Snapshot.noopLayer],
  [Config.node, config],
] as const

const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(runnerNodes, [...overrides])))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([runnerNodes, SessionExecution.node, SessionV2.node]), [
    ...overrides,
    [SessionExecution.node, execution],
  ]),
)

const sessionID = SessionV2.ID.make("ses_doom_loop_test")
const agentID = AgentV2.ID.make("build")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  executions.length = 0
  responses = []
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: "/project",
      title: "test",
      version: "test",
      agent: agentID,
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  // Mirror V1 defaults: everything allowed except doom_loop, which must be decided explicitly.
  const agents = yield* AgentV2.Service
  yield* agents.transform((editor) =>
    editor.update(agentID, (agent) => {
      agent.permissions = [
        { action: "*", resource: "*", effect: "allow" },
        { action: "doom_loop", resource: "*", effect: "ask" },
      ]
    }),
  )
})

const callEvents = (name: string, input: Record<string, unknown>, id: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.toolCall({ id, name, input }),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]

const stop = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

/** Answers every doom_loop permission request with `reply`, recording what was asked. */
const answerDoomLoop = (reply: "once" | "reject") =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const service = yield* PermissionV2.Service
    const asked: PermissionV2.Request[] = []
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== PermissionV2.Event.Asked.type) return Effect.void
      const request = event.data as PermissionV2.Request
      if (request.action !== "doom_loop") return Effect.void
      asked.push(request)
      // Reply inline: `assert` awaits a deferred, so resolving it here unblocks the waiting tool.
      return service.reply({ requestID: request.id, reply }).pipe(Effect.catch(() => Effect.void))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    return asked
  })

describe("DoomLoop detection", () => {
  const tool = (name: string, status: "pending" | "running" | "completed", input: unknown) =>
    ({
      type: "tool" as const,
      id: `call-${name}-${String(status)}-${JSON.stringify(input)}`,
      name,
      state:
        status === "pending"
          ? { status: "pending" as const, input: JSON.stringify(input) }
          : status === "running"
            ? { status: "running" as const, input: input as Record<string, unknown>, structured: {}, content: [] }
            : {
                status: "completed" as const,
                input: input as Record<string, unknown>,
                structured: {},
                content: [],
              },
      time: { created: undefined as never },
    }) as never

  const text = { type: "text" as const, id: "t", text: "hi", time: { created: undefined as never } } as never

  it.effect("uses the V1 threshold of three", () =>
    Effect.sync(() => {
      expect(DoomLoop.DOOM_LOOP_THRESHOLD).toBe(3)
    }),
  )

  it.effect("normalizes non-record input exactly like V1", () =>
    Effect.sync(() => {
      expect(DoomLoop.normalizeInput("x")).toEqual({ value: "x" })
      expect(DoomLoop.normalizeInput([1])).toEqual({ value: [1] })
      expect(DoomLoop.normalizeInput({ a: 1 })).toEqual({ a: 1 })
    }),
  )

  it.effect("detects three identical non-pending calls", () =>
    Effect.sync(() => {
      const content = [
        tool("echo", "completed", { text: "a" }),
        tool("echo", "completed", { text: "a" }),
        tool("echo", "running", { text: "a" }),
      ]
      expect(DoomLoop.isRepeating(content, "echo", { text: "a" })).toBe(true)
    }),
  )

  it.effect("does not trigger before the third call", () =>
    Effect.sync(() => {
      const content = [tool("echo", "completed", { text: "a" }), tool("echo", "running", { text: "a" })]
      expect(DoomLoop.isRepeating(content, "echo", { text: "a" })).toBe(false)
    }),
  )

  it.effect("does not trigger when any part is pending", () =>
    Effect.sync(() => {
      const content = [
        tool("echo", "completed", { text: "a" }),
        tool("echo", "pending", { text: "a" }),
        tool("echo", "running", { text: "a" }),
      ]
      expect(DoomLoop.isRepeating(content, "echo", { text: "a" })).toBe(false)
    }),
  )

  it.effect("changed input breaks the streak", () =>
    Effect.sync(() => {
      const content = [
        tool("echo", "completed", { text: "a" }),
        tool("echo", "completed", { text: "b" }),
        tool("echo", "running", { text: "a" }),
      ]
      expect(DoomLoop.isRepeating(content, "echo", { text: "a" })).toBe(false)
    }),
  )

  it.effect("a different tool breaks the streak", () =>
    Effect.sync(() => {
      const content = [
        tool("echo", "completed", { text: "a" }),
        tool("other", "completed", { text: "a" }),
        tool("echo", "running", { text: "a" }),
      ]
      expect(DoomLoop.isRepeating(content, "echo", { text: "a" })).toBe(false)
    }),
  )

  it.effect("an intervening text part breaks the streak", () =>
    Effect.sync(() => {
      const content = [
        tool("echo", "completed", { text: "a" }),
        text,
        tool("echo", "completed", { text: "a" }),
        tool("echo", "running", { text: "a" }),
      ]
      // The trailing window still holds two tools plus one text, so it cannot be a streak.
      expect(DoomLoop.isRepeating([content[1]!, content[2]!, content[3]!], "echo", { text: "a" })).toBe(false)
    }),
  )
})

const multiCall = (calls: ReadonlyArray<{ id: string; name: string; input: Record<string, unknown> }>) => [
  LLMEvent.stepStart({ index: 0 }),
  ...calls.map((call) => LLMEvent.toolCall({ id: call.id, name: call.name, input: call.input })),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]

const echoCall = (id: string, text: string) => ({ id, name: "echo", input: { text } })

describe("SessionRunnerLLM doom loop", () => {
  it.effect("asks on the third identical call and runs it once approved", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Repeat" }), resume: false })
      responses = [multiCall([echoCall("c1", "a"), echoCall("c2", "a"), echoCall("c3", "a")]), stop]

      const asked = yield* answerDoomLoop("once")
      yield* session.resume(sessionID)

      // All three run: the first two freely, the third only after an explicit approval.
      expect(executions).toEqual(["a", "a", "a"])
      // The third call is the one that required a decision.
      expect(asked).toHaveLength(1)
      expect(asked[0]).toMatchObject({ action: "doom_loop", resources: ["echo"] })
    }),
  )

  it.effect("halts the turn when the third identical call is declined", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Repeat" }), resume: false })
      responses = [multiCall([echoCall("c1", "a"), echoCall("c2", "a"), echoCall("c3", "a")]), stop]

      yield* answerDoomLoop("reject")
      const exit = yield* session.resume(sessionID).pipe(Effect.exit)

      // Exactly the existing V2 declined-halt path.
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(executions).toEqual(["a", "a"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Repeat" },
        { type: "assistant", content: [{}, {}, { type: "tool", id: "c3", state: { status: "error" } }] },
      ])
    }),
  )

  it.effect("does not ask when the third call changes its input", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Vary" }), resume: false })
      responses = [multiCall([echoCall("c1", "a"), echoCall("c2", "a"), echoCall("c3", "b")]), stop]

      const asked = yield* answerDoomLoop("reject")
      yield* session.resume(sessionID)
      expect(executions).toEqual(["a", "a", "b"])
      expect(asked).toHaveLength(0)
      expect(asked).toHaveLength(0)
    }),
  )

  it.effect("does not ask when a different tool breaks the streak", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Mix" }), resume: false })
      responses = [
        multiCall([echoCall("c1", "a"), { id: "c2", name: "other", input: { text: "a" } }, echoCall("c3", "a")]),
        stop,
      ]

      const asked = yield* answerDoomLoop("reject")
      yield* session.resume(sessionID)
      expect(executions).toEqual(["a", "other:a", "a"])
      expect(asked).toHaveLength(0)
    }),
  )

  it.effect("does not ask for only two identical calls", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Twice" }), resume: false })
      responses = [multiCall([echoCall("c1", "a"), echoCall("c2", "a")]), stop]

      const asked = yield* answerDoomLoop("reject")
      yield* session.resume(sessionID)
      expect(executions).toEqual(["a", "a"])
      expect(asked).toHaveLength(0)
    }),
  )
})
