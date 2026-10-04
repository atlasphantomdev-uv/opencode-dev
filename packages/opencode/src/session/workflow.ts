import { Option, Schema } from "effect"
import { SessionID } from "./schema"

/**
 * Runtime-validated orchestration state.
 *
 * The model decides *whether* a delegation needs independent verification. Once it
 * says so (`verification: "required"` on the task tool), the runtime keeps an
 * obligation for that session and refuses further delegation until an independent
 * verification task reports a passing contract. Complexity classification, agent
 * choice, and parallelism stay model-driven; only the declared obligation is
 * enforced here.
 */

export const Contract = Schema.Struct({
  status: Schema.Literals(["completed", "failed", "blocked"]),
  summary: Schema.String,
  evidence: Schema.optional(
    Schema.Array(
      Schema.Struct({
        file: Schema.String,
        line: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
        claim: Schema.String,
      }),
    ),
  ),
  verification: Schema.optional(
    Schema.Struct({
      required: Schema.Boolean,
      passed: Schema.Boolean,
      command: Schema.optional(Schema.String),
    }),
  ),
})
export type Contract = Schema.Schema.Type<typeof Contract>

export type Role = "none" | "required" | "verify"
export type Status = "none" | "pending" | "failed" | "passed"

export const METADATA_KEY = "opencode.workflow"

export interface State {
  status: Status
  failures: number
  implementationAgent?: string
  skills: string[]
}

const PersistedState = Schema.Struct({
  status: Schema.Literals(["none", "pending", "failed", "passed"]),
  failures: Schema.Int,
  implementationAgent: Schema.optional(Schema.String),
  skills: Schema.Array(Schema.String),
})

export const MAX_FAILURES = 3

const states = new Map<SessionID, State>()

function state(sessionID: SessionID): State {
  const existing = states.get(sessionID)
  if (existing) return existing
  const next: State = { status: "none", failures: 0, skills: [] }
  states.set(sessionID, next)
  return next
}

export function get(sessionID: SessionID): State {
  const current = state(sessionID)
  return { ...current, skills: [...current.skills] }
}

/** Return the state shape stored in session metadata for process restart recovery. */
export function snapshot(sessionID: SessionID): State {
  return get(sessionID)
}

/** Restore a previously persisted state. Invalid or absent metadata is ignored. */
export function restore(input: { sessionID: SessionID; value: unknown }): void {
  const decoded = Schema.decodeUnknownOption(PersistedState)(input.value)
  if (Option.isNone(decoded)) return
  if (decoded.value.failures < 0) return
  states.set(input.sessionID, { ...decoded.value, skills: [...decoded.value.skills] })
}

/** Test/cleanup hook. Clears all tracked workflow obligations. */
export function reset(): void {
  states.clear()
}

export interface Decision {
  ok: boolean
  reason?: string
}

/**
 * Check whether a delegation may start. Pure — does not mutate workflow state, so a
 * denied permission ask or a failed session create cannot leave a spurious
 * obligation behind. Call `commit` once the delegation is actually starting.
 *
 * - `required` starts (or heals) an obligation and marks verification pending.
 * - `verify` is only allowed while an obligation is outstanding.
 * - `none` is blocked while an obligation is outstanding so new work cannot
 *   proceed as if verification had happened.
 */
export function check(input: { sessionID: SessionID; role: Role; agent: string }): Decision {
  const current = state(input.sessionID)

  if (input.role === "verify") {
    if (current.status !== "pending" && current.status !== "failed") {
      return { ok: false, reason: "no verification is outstanding for this session" }
    }
    if (current.failures >= MAX_FAILURES) {
      return {
        ok: false,
        reason: `verification failed ${current.failures} times (limit ${MAX_FAILURES}); escalate before retrying`,
      }
    }
    if (current.implementationAgent === input.agent) {
      return { ok: false, reason: "verification must be performed by a different agent" }
    }
    return { ok: true }
  }

  if (current.status === "pending") {
    return { ok: false, reason: 'verification is pending; run a verification task (verification="verify") first' }
  }

  if (current.status === "failed") {
    if (input.role === "none") {
      return { ok: false, reason: 'verification failed; heal with verification="required" or escalate' }
    }
    if (current.failures >= MAX_FAILURES) {
      return { ok: false, reason: `healing limit (${MAX_FAILURES}) reached; escalate to the operator` }
    }
  }

  return { ok: true }
}

/** Apply a passing `check`. No-op for the `verify` role, which is applied by `record`. */
export function commit(input: { sessionID: SessionID; role: Role; agent: string; skills?: readonly string[] }): void {
  if (input.role === "verify") return
  const current = state(input.sessionID)
  const healing = current.status === "failed"
  if (!healing) {
    current.failures = 0
    current.skills = []
  }
  if (input.role === "required") {
    current.status = "pending"
    current.implementationAgent = input.agent
    if (input.skills) current.skills = [...input.skills]
  } else if (input.skills?.length) {
    current.skills = [...input.skills]
  }
}

/** Apply the outcome of a completed contract against the obligation. */
export function record(input: { sessionID: SessionID; role: Role; agent: string; contract: Contract }): void {
  if (input.role !== "verify") return
  const current = state(input.sessionID)
  if (current.implementationAgent === input.agent) {
    current.status = "failed"
    current.failures += 1
    return
  }
  if (input.contract.status === "completed" && input.contract.verification?.passed === true) {
    current.status = "passed"
    return
  }
  current.status = "failed"
  current.failures += 1
}

export function render(contract: Contract): string {
  return JSON.stringify(contract)
}

const FENCED = /```json\s*([\s\S]*?)```/g

/** Extract and validate the structured result contract from a subagent's final message. */
export function parse(text: string): Contract | undefined {
  const fenced = Array.from(text.matchAll(FENCED)).at(-1)?.[1]
  const candidate = fenced ?? (/^\s*\{[\s\S]*\}\s*$/.test(text) ? text : undefined)
  if (candidate === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return undefined
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(Contract)(parsed))
}

export const INSTRUCTION = [
  "",
  "[workflow] This delegation has a structured result contract. End your final message with a fenced ```json block, and nothing after it, matching:",
  '{"status":"completed|failed|blocked","summary":"...","evidence":[{"file":"...","line":1,"claim":"..."}],"verification":{"required":true,"passed":true,"command":"..."}}',
  'Fields: status and summary are required. evidence and verification are optional; include verification only when you performed a verification step. Note exactly one of "completed" | "failed" | "blocked".',
].join("\n")

export * as Workflow from "./workflow"
