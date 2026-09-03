import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMError,
  LLMEvent,
  Model,
  AuthenticationReason,
  ProviderInternalReason,
  RateLimitReason,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { PermissionV2 } from "@opencode-ai/core/permission"
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
import { SessionRunnerRetry } from "@opencode-ai/core/session/runner/retry"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
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
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

// One provider turn per queued outcome. `undefined` means "succeed with a trivial stop turn".
const requests: LLMRequest[] = []
let outcomes: (LLMError | undefined)[] = []
let oneShotStream: Stream.Stream<LLMEvent, LLMError> | undefined
let streamGate: Deferred.Deferred<void> | undefined
let streamStarted: Deferred.Deferred<void> | undefined

const okEvents = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-ok" }),
  LLMEvent.textDelta({ id: "text-ok", text: "Recovered" }),
  LLMEvent.textEnd({ id: "text-ok" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      if (oneShotStream) {
        const stream = oneShotStream
        oneShotStream = undefined
        return stream
      }
      const outcome = outcomes.length > 0 ? outcomes.shift() : undefined
      const events = outcome ? Stream.fail(outcome) : Stream.fromIterable(okEvents)
      if (!streamGate) return events
      return Stream.unwrap(
        (streamStarted ? Deferred.succeed(streamStarted, undefined) : Effect.void).pipe(
          Effect.andThen(Deferred.await(streamGate)),
          Effect.as(events),
        ),
      )
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const models = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({ resolve: () => Effect.succeed(model) }),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const systemContextKey = SystemContext.Key.make("test/context")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.sync(() =>
          SystemContext.make({
            key: systemContextKey,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed("Initial context"),
            baseline: String,
            update: (_previous, current) => current,
            removed: () => "System context source removed: test/context",
          }),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
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

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
])

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
).pipe(Layer.provide(runnerLayer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_runner_retry_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  outcomes = []
  oneShotStream = undefined
  streamGate = undefined
  streamStarted = undefined
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
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const rateLimited = () =>
  new LLMError({ module: "test", method: "stream", reason: new RateLimitReason({ message: "Slow down" }) })

const providerInternal = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new ProviderInternalReason({ message: "Upstream exploded", status: 503 }),
  })

const unauthorized = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new AuthenticationReason({ message: "Bad key", kind: "invalid" }),
  })

const retryEvents = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return yield* db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.filter((row) => row.type.startsWith("session.next.retried"))),
    )
})

// Advances the TestClock far enough to release every bounded backoff sleep.
const drainBackoff = TestClock.adjust(
  SessionRunnerRetry.RETRY_MAX_DELAY_NO_HEADERS * (SessionRunnerRetry.RETRY_MAX_RETRIES + 2),
)

const runWithBackoff = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* effect.pipe(Effect.forkChild)
    yield* drainBackoff
    return yield* Fiber.join(fiber)
  })

describe("SessionRunnerRetry policy", () => {
  it.effect("keeps the V1 retry budget of five retries", () =>
    Effect.sync(() => {
      expect(SessionRunnerRetry.RETRY_MAX_RETRIES).toBe(5)
      expect(SessionRunnerRetry.withinBudget(5)).toBe(true)
      expect(SessionRunnerRetry.withinBudget(6)).toBe(false)
    }),
  )

  it.effect("uses V1 exponential backoff capped at 30 seconds without a provider hint", () =>
    Effect.sync(() => {
      const delays = Array.from({ length: 6 }, (_, index) => SessionRunnerRetry.delay(index + 1, undefined, 0))
      expect(delays).toStrictEqual([2000, 4000, 8000, 16000, 30000, 30000])
      expect(SessionRunnerRetry.delay(1, undefined, 1)).toBe(2500)
    }),
  )

  it.effect("honors an explicit provider retry hint above the headerless cap", () =>
    Effect.sync(() => {
      expect(SessionRunnerRetry.delay(1, 90_000)).toBe(90_000)
      expect(SessionRunnerRetry.delay(1, Number.MAX_SAFE_INTEGER)).toBe(SessionRunnerRetry.RETRY_MAX_DELAY)
    }),
  )

  it.effect("classifies transient provider failures as retryable and terminal ones as not", () =>
    Effect.sync(() => {
      expect(SessionRunnerRetry.retryable(rateLimited())).toBe(true)
      expect(SessionRunnerRetry.retryable(providerInternal())).toBe(true)
      expect(SessionRunnerRetry.retryable(unauthorized())).toBe(false)
      expect(SessionRunnerRetry.retryable(new Error("not an LLM error"))).toBe(false)
    }),
  )
})

describe("SessionRunnerLLM bounded provider retries", () => {
  it.effect("retries a retryable provider failure and succeeds on a later attempt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Retry me" }), resume: false })
      requests.length = 0
      outcomes = [rateLimited(), providerInternal(), undefined]

      yield* runWithBackoff(session.resume(sessionID))

      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Retry me" },
        { type: "assistant", content: [{ type: "text", text: "Recovered" }] },
      ])
      const retried = yield* retryEvents
      expect(retried).toHaveLength(2)
      expect(retried.map((row) => (row.data as { attempt: number }).attempt)).toEqual([1, 2])
    }),
  )

  it.effect("stops after the retry budget is exhausted and fails terminally", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Always failing" }), resume: false })
      requests.length = 0
      const failure = rateLimited()
      outcomes = Array.from({ length: 20 }, () => failure)

      expect(yield* runWithBackoff(session.resume(sessionID).pipe(Effect.flip))).toBe(failure)

      // One initial attempt plus the full V1 budget of retries.
      expect(requests).toHaveLength(SessionRunnerRetry.RETRY_MAX_RETRIES + 1)
      expect(yield* retryEvents).toHaveLength(SessionRunnerRetry.RETRY_MAX_RETRIES)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Always failing" },
        { type: "assistant", finish: "error", error: { type: "unknown", message: failure.reason.message } },
      ])
    }),
  )

  it.effect("does not retry a non-retryable provider failure", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Terminal failure" }), resume: false })
      requests.length = 0
      const failure = unauthorized()
      outcomes = [failure, undefined]

      expect(yield* runWithBackoff(session.resume(sessionID).pipe(Effect.flip))).toBe(failure)

      expect(requests).toHaveLength(1)
      expect(yield* retryEvents).toHaveLength(0)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Terminal failure" },
        { type: "assistant", finish: "error", error: { type: "unknown", message: failure.reason.message } },
      ])
    }),
  )

  it.effect("does not retry after the provider already produced assistant content", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Partial then fail" }), resume: false })
      requests.length = 0
      const failure = rateLimited()
      oneShotStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-partial" }),
          LLMEvent.textDelta({ id: "text-partial", text: "Partial" }),
          LLMEvent.textEnd({ id: "text-partial" }),
        ]),
        Stream.fail(failure),
      )
      outcomes = [undefined]

      expect(yield* runWithBackoff(session.resume(sessionID).pipe(Effect.flip))).toBe(failure)

      // Durable assistant output already exists, so the turn is not safe to re-attempt.
      expect(requests).toHaveLength(1)
      expect(yield* retryEvents).toHaveLength(0)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Partial then fail" },
        {
          type: "assistant",
          finish: "error",
          error: { type: "unknown", message: failure.reason.message },
          content: [{ type: "text", text: "Partial" }],
        },
      ])
    }),
  )

  it.effect("cancels instead of retrying when interrupted during backoff", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Interrupt during backoff" }), resume: false })
      requests.length = 0
      outcomes = Array.from({ length: 20 }, () => rateLimited())

      const fiber = yield* session.resume(sessionID).pipe(Effect.forkChild)
      // Let the first attempt fail and park in the bounded backoff wait.
      yield* TestClock.adjust(1)
      expect(requests).toHaveLength(1)
      expect(yield* retryEvents).toHaveLength(1)

      yield* (yield* SessionExecution.Service).interrupt(sessionID)
      yield* Fiber.await(fiber)
      // Releasing every remaining backoff must not resurrect the cancelled run.
      yield* drainBackoff
      expect(requests).toHaveLength(1)
      expect(yield* retryEvents).toHaveLength(1)
    }),
  )
})
