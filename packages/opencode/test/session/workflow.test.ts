import { afterEach, describe, expect, test } from "bun:test"
import { SessionID } from "../../src/session/schema"
import { Workflow } from "../../src/session/workflow"

const sid = () => SessionID.make(`ses_${Math.random().toString(36).slice(2)}`)
const contract = (over: Partial<Workflow.Contract> = {}): Workflow.Contract => ({
  status: "completed",
  summary: "ok",
  ...over,
})

afterEach(() => Workflow.reset())

describe("session.workflow", () => {
  test("parse accepts a fenced or bare contract and rejects malformed input", () => {
    expect(Workflow.parse('```json\n{"status":"completed","summary":"x"}\n```')).toEqual({
      status: "completed",
      summary: "x",
    })
    expect(Workflow.parse('{"status":"failed","summary":"boom"}')).toEqual({ status: "failed", summary: "boom" })
    expect(
      Workflow.parse(
        '```json\n{"status":"completed","summary":"x","verification":{"required":true,"passed":true}}\n```',
      ),
    ).toEqual({ status: "completed", summary: "x", verification: { required: true, passed: true } })

    expect(Workflow.parse("done")).toBeUndefined()
    expect(Workflow.parse('```json\n{"status":"nope","summary":"x"}\n```')).toBeUndefined()
    expect(Workflow.parse("```json\nnot json\n```")).toBeUndefined()
  })

  test("tracks a required -> verify-passed obligation", () => {
    const id = sid()
    expect(Workflow.get(id).status).toBe("none")
    expect(Workflow.check({ sessionID: id, role: "required", agent: "general" }).ok).toBe(true)
    Workflow.commit({ sessionID: id, role: "required", agent: "general", skills: ["effect"] })
    expect(Workflow.get(id).status).toBe("pending")
    expect(Workflow.get(id).skills).toEqual(["effect"])

    // New work is blocked while verification is outstanding.
    expect(Workflow.check({ sessionID: id, role: "none", agent: "general" }).ok).toBe(false)

    expect(Workflow.check({ sessionID: id, role: "verify", agent: "general" })).toEqual({
      ok: false,
      reason: "verification must be performed by a different agent",
    })
    expect(Workflow.check({ sessionID: id, role: "verify", agent: "moderator" }).ok).toBe(true)
    Workflow.record({
      sessionID: id,
      role: "verify",
      agent: "moderator",
      contract: contract({ verification: { required: true, passed: true } }),
    })
    expect(Workflow.get(id).status).toBe("passed")
    expect(Workflow.check({ sessionID: id, role: "none", agent: "general" }).ok).toBe(true)
  })

  test("a denied check does not mutate state", () => {
    const id = sid()
    expect(Workflow.check({ sessionID: id, role: "verify", agent: "moderator" }).ok).toBe(false)
    expect(Workflow.get(id).status).toBe("none")
  })

  test("restores persisted state after an in-memory reset", () => {
    const id = sid()
    Workflow.commit({ sessionID: id, role: "required", agent: "general", skills: ["effect"] })
    const saved = Workflow.snapshot(id)

    Workflow.reset()
    expect(Workflow.get(id).status).toBe("none")
    Workflow.restore({ sessionID: id, value: saved })

    expect(Workflow.get(id)).toEqual(saved)
  })

  test("counts failures, permits healing, and caps attempts", () => {
    const id = sid()
    Workflow.commit({ sessionID: id, role: "required", agent: "general" })
    for (let i = 0; i < Workflow.MAX_FAILURES; i++) {
      expect(Workflow.check({ sessionID: id, role: "verify", agent: "moderator" }).ok).toBe(true)
      Workflow.record({
        sessionID: id,
        role: "verify",
        agent: "moderator",
        contract: contract({ verification: { required: true, passed: false } }),
      })
      if (i < Workflow.MAX_FAILURES - 1) {
        expect(Workflow.check({ sessionID: id, role: "required", agent: "general" }).ok).toBe(true)
        Workflow.commit({ sessionID: id, role: "required", agent: "general" })
      }
    }
    expect(Workflow.get(id).failures).toBe(Workflow.MAX_FAILURES)
    expect(Workflow.check({ sessionID: id, role: "required", agent: "general" }).ok).toBe(false)
    expect(Workflow.check({ sessionID: id, role: "verify", agent: "moderator" }).ok).toBe(false)
  })

  test("requires a completed contract before clearing verification", () => {
    const id = sid()
    Workflow.commit({ sessionID: id, role: "required", agent: "general" })
    Workflow.record({
      sessionID: id,
      role: "verify",
      agent: "moderator",
      contract: contract({ status: "failed", verification: { required: true, passed: true } }),
    })
    expect(Workflow.get(id).status).toBe("failed")
  })

  test("rejects verify without an outstanding obligation", () => {
    const id = sid()
    expect(Workflow.check({ sessionID: id, role: "verify", agent: "moderator" }).ok).toBe(false)
  })
})
