import { describe, expect, test } from "bun:test"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { GrepTool } from "@opencode-ai/core/tool/grep"

/**
 * Search results clipped by `limit` must be distinguishable from a complete result set.
 *
 * Without this signal a model cannot tell "there are no more matches" from "the list was
 * cut off", so it can wrongly conclude a file or symbol does not exist.
 */
const entries = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `file-${index}.ts` }))

const matches = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    entry: { path: `file-${index}.ts` },
    line: index + 1,
    text: "needle",
  }))

describe("glob truncation signalling", () => {
  test("marks a result set clipped at the limit", () => {
    const output = GlobTool.toModelOutput(entries(3) as never, 3)

    expect(output).toContain("file-0.ts")
    expect(output).toContain("file-2.ts")
    expect(output).toContain("truncated")
  })

  test("leaves a complete result set unchanged", () => {
    const output = GlobTool.toModelOutput(entries(2) as never, 3)

    expect(output).toBe("file-0.ts\nfile-1.ts")
  })

  test("leaves an unbounded result set unchanged", () => {
    const output = GlobTool.toModelOutput(entries(2) as never)

    expect(output).toBe("file-0.ts\nfile-1.ts")
  })

  test("keeps the empty result message", () => {
    expect(GlobTool.toModelOutput([] as never, 3)).toBe("No files found")
  })
})

describe("grep truncation signalling", () => {
  test("marks a match set clipped at the limit", () => {
    const output = GrepTool.toModelOutput(matches(2) as never, 2)

    expect(output).toContain("Found 2 matches")
    expect(output).toContain("truncated")
  })

  test("leaves a complete match set unchanged", () => {
    const output = GrepTool.toModelOutput(matches(1) as never, 5)

    expect(output.startsWith("Found 1 matches")).toBe(true)
    expect(output).not.toContain("truncated")
  })

  test("keeps the empty result message", () => {
    expect(GrepTool.toModelOutput([] as never, 5)).toBe("No files found")
  })
})
