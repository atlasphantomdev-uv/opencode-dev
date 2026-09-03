import { LLMError } from "@opencode-ai/llm"

/**
 * Bounded provider retry policy for one V2 provider turn.
 *
 * Mirrors the V1 `SessionRetry` budget and backoff (`packages/opencode/src/session/retry.ts`)
 * without introducing a retry subsystem: these are pure functions the runner calls inline.
 *
 * V1 parity notes:
 * - budget is 5 retries (6 provider attempts total)
 * - backoff is exponential from 2s, doubling, with 25% jitter
 * - no provider retry hint caps the wait at 30s; an explicit hint is honored up to the timer limit
 * - context-overflow and other terminal provider failures are never retried
 */
export const RETRY_INITIAL_DELAY = 2_000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_JITTER_FACTOR = 0.25
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000
export const RETRY_MAX_DELAY = 2_147_483_647
export const RETRY_MAX_RETRIES = 5

const cap = (ms: number) => Math.min(ms, RETRY_MAX_DELAY)

const exponential = (attempt: number, random: number) => {
  const base = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
  return Math.ceil(base + base * RETRY_JITTER_FACTOR * random)
}

/** Wait before retry `attempt` (1-based), honoring an explicit provider hint when present. */
export const delay = (attempt: number, retryAfterMs?: number, random = Math.random()) => {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) return cap(Math.max(0, retryAfterMs))
  return cap(Math.min(exponential(attempt, random), RETRY_MAX_DELAY_NO_HEADERS))
}

/** True when `error` is a transient provider failure the runner may re-attempt. */
export const retryable = (error: unknown): error is LLMError => error instanceof LLMError && error.retryable

/** True when another attempt is still inside the budget. `attempt` is the 1-based retry number. */
export const withinBudget = (attempt: number) => attempt <= RETRY_MAX_RETRIES

/** Durable retry-notice payload for `session.next.retried`. */
export const notice = (error: LLMError) => ({
  message: error.message,
  isRetryable: true,
  ...("status" in error.reason && typeof error.reason.status === "number" ? { statusCode: error.reason.status } : {}),
})

export * as SessionRunnerRetry from "./retry"
