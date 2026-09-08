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
/**
 * `truncate` and `truncateLeft` share the `slice(-0)` / negative-length hazard fixed in
 * `truncateMiddle`: at `len <= 1` the slice degenerates and the helpers return more characters
 * than requested — `truncateLeft` can return more than the input itself.
 *
 * `dialog-move-session.tsx:151` computes `Math.max(1, Math.min(116, width - 2) - 12)`, so a
 * terminal narrower than ~16 columns asks for one character and would receive the whole title.
 */
describe("Locale.truncate", () => {
  test("returns short text unchanged", () => {
    expect(Locale.truncate("abc", 10)).toBe("abc")
    expect(Locale.truncate("abcdefghij", 10)).toBe("abcdefghij")
  })

  test("truncates from the right for ordinary widths", () => {
    expect(Locale.truncate("abcdefghij", 5)).toBe("abcd…")
    expect(Locale.truncate("abcdefghij", 2)).toBe("a…")
    expect(Locale.truncate("abcdefghij", 1)).toBe("…")
  })

  test("never exceeds len at small widths", () => {
    for (const len of [0, 1, 2, 3, 5]) {
      expect(Locale.truncate("abcdefghij", len).length).toBeLessThanOrEqual(Math.max(len, 0))
    }
  })
})

describe("Locale.truncateLeft", () => {
  test("returns short text unchanged", () => {
    expect(Locale.truncateLeft("abc", 10)).toBe("abc")
    expect(Locale.truncateLeft("abcdefghij", 10)).toBe("abcdefghij")
  })

  test("truncates from the left for ordinary widths", () => {
    expect(Locale.truncateLeft("abcdefghij", 5)).toBe("…ghij")
    expect(Locale.truncateLeft("abcdefghij", 2)).toBe("…j")
    expect(Locale.truncateLeft("abcdefghij", 1)).toBe("…")
  })

  test("never exceeds len at small widths", () => {
    for (const len of [0, 1, 2, 3, 5]) {
      expect(Locale.truncateLeft("abcdefghij", len).length).toBeLessThanOrEqual(Math.max(len, 0))
    }
  })

  test("never returns more than the original input", () => {
    for (const len of [0, 1, 2]) {
      expect(Locale.truncateLeft("abcdefghij", len).length).toBeLessThanOrEqual("abcdefghij".length)
    }
  })
})

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
