import { describe, expect, test } from "bun:test"
import { Locale } from "@opencode-ai/tui/util/locale"

/**
 * `truncateMiddle` must never return more characters than `maxLength`.
 *
 * `String.prototype.slice(-0)` returns the whole string rather than an empty one, so a
 * `maxLength` small enough to make the trailing slice zero-length used to append the entire
 * input and produce output longer than the original. Callers pass terminal-derived widths
 * (`Math.max(1, ...)`), so narrow terminals reach these values.
 */
describe("Locale.truncateMiddle", () => {
  test("returns short text unchanged", () => {
    expect(Locale.truncateMiddle("abc", 10)).toBe("abc")
    expect(Locale.truncateMiddle("abcdefghij", 10)).toBe("abcdefghij")
  })

  test("truncates in the middle for ordinary widths", () => {
    expect(Locale.truncateMiddle("abcdefghij", 5)).toBe("ab…ij")
    expect(Locale.truncateMiddle("abcdefghij", 4)).toBe("ab…j")
    expect(Locale.truncateMiddle("abcdefghij", 3)).toBe("a…j")
  })

  test("never exceeds maxLength at small widths", () => {
    for (const maxLength of [0, 1, 2, 3, 4, 5]) {
      const result = Locale.truncateMiddle("abcdefghij", maxLength)
      expect(result.length).toBeLessThanOrEqual(Math.max(maxLength, 0))
    }
  })

  test("never returns more than the original input", () => {
    for (const maxLength of [0, 1, 2]) {
      expect(Locale.truncateMiddle("abcdefghij", maxLength).length).toBeLessThanOrEqual("abcdefghij".length)
    }
  })
})
