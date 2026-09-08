import { describe, expect, test } from "bun:test"
import { truncateMiddle } from "@opencode-ai/core/util/path"

/**
 * `truncateMiddle` must never return more characters than `maxLength`.
 *
 * `String.prototype.slice(-0)` returns the whole string rather than an empty one, so a
 * `maxLength` small enough to make the trailing slice zero-length used to append the entire
 * input and produce output longer than the original. Callers pass terminal-derived widths
 * (`Math.max(1, ...)`), so the small values are reachable.
 */
describe("truncateMiddle", () => {
  test("returns short text unchanged", () => {
    expect(truncateMiddle("abc", 10)).toBe("abc")
    expect(truncateMiddle("abcdefghij", 10)).toBe("abcdefghij")
  })

  test("truncates in the middle for ordinary widths", () => {
    expect(truncateMiddle("abcdefghij", 5)).toBe("ab…ij")
    expect(truncateMiddle("abcdefghij", 4)).toBe("ab…j")
    expect(truncateMiddle("abcdefghij", 3)).toBe("a…j")
  })

  test("never exceeds maxLength at small widths", () => {
    for (const maxLength of [0, 1, 2, 3, 4, 5]) {
      const result = truncateMiddle("abcdefghij", maxLength)
      expect(result.length).toBeLessThanOrEqual(Math.max(maxLength, 0))
    }
  })

  test("never returns more than the original input", () => {
    for (const maxLength of [0, 1, 2]) {
      expect(truncateMiddle("abcdefghij", maxLength).length).toBeLessThanOrEqual("abcdefghij".length)
    }
  })
})
