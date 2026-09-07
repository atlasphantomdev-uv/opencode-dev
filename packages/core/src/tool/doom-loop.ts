import type { SessionMessage } from "../session/message"

/**
 * Repeated identical tool call detection ("doom loop").
 *
 * Mirrors V1 `SessionProcessor` (`packages/opencode/src/session/processor.ts`), which inspects the
 * last `DOOM_LOOP_THRESHOLD` parts of the current assistant message and asks for permission when
 * every one of them is the same tool, non-pending, with a serialization-equal input.
 *
 * V1 parity notes:
 * - threshold is 3, counted over the trailing content of one assistant message
 * - the current call is already recorded as `running` when the check runs, so it is the third part
 * - equality is `JSON.stringify(input)` on both sides, matching V1 exactly
 * - a pending part, a different tool, a different input, or any intervening text/reasoning part
 *   breaks the streak because the trailing window must be entirely matching tool parts
 */
export const DOOM_LOOP_THRESHOLD = 3

/** V1 normalizes non-record tool input to `{ value: input }` before comparing. */
export const normalizeInput = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value }

/**
 * True when the trailing `DOOM_LOOP_THRESHOLD` content parts are all the same non-pending tool
 * with an identical serialized input. `content` must be the assistant message content in order,
 * already including the current call.
 */
export const isRepeating = (content: ReadonlyArray<SessionMessage.AssistantContent>, name: string, input: unknown) => {
  const recent = content.slice(-DOOM_LOOP_THRESHOLD)
  if (recent.length !== DOOM_LOOP_THRESHOLD) return false
  const serialized = JSON.stringify(normalizeInput(input))
  return recent.every(
    (part) =>
      part.type === "tool" &&
      part.name === name &&
      part.state.status !== "pending" &&
      JSON.stringify(part.state.input) === serialized,
  )
}

export * as DoomLoop from "./doom-loop"
