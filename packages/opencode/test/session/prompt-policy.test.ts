import { describe, expect, test } from "bun:test"
import promptDefault from "../../src/session/prompt/default.txt"
import promptBuildSwitch from "../../src/session/prompt/build-switch.txt"
import promptPlan from "../../src/session/prompt/plan.txt"

describe("fork prompt policy", () => {
  /**
   * The fork layers its engineering policy onto upstream provider prompts inside these two files
   * (`7f60b63e11`). Upstream sync must preserve these sections, and core ships byte-identical
   * copies for the V2 runtime.
   */
  test("v1 assets keep the fork policy sections", () => {
    expect(promptDefault).toContain("## Engineering Execution Loop")
    expect(promptBuildSwitch).toContain("## Build Execution")
    expect(promptPlan).toContain("# Plan Mode - System Reminder")
  })
})
