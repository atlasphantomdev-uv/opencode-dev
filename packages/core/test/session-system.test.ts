import { describe, expect, it } from "bun:test"
import { Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { SystemPrompt } from "@opencode-ai/core/session/system"
import promptAnthropic from "../src/session/prompt/anthropic.txt"
import promptBeast from "../src/session/prompt/beast.txt"
import promptCodex from "../src/session/prompt/codex.txt"
import promptDefault from "../src/session/prompt/default.txt"
import promptGemini from "../src/session/prompt/gemini.txt"
import promptGpt from "../src/session/prompt/gpt.txt"
import promptKimi from "../src/session/prompt/kimi.txt"
import promptMeta from "../src/session/prompt/meta.txt"
import promptTrinity from "../src/session/prompt/trinity.txt"

const make = (id: string, provider = "provider") => Model.make({ id, provider, route: OpenAIChat.route })

describe("SystemPrompt", () => {
  it("selects the model-family base prompt", () => {
    expect(SystemPrompt.provider(make("claude-sonnet-4-5"))).toBe(promptAnthropic)
    expect(SystemPrompt.provider(make("gpt-4.1"))).toBe(promptBeast)
    expect(SystemPrompt.provider(make("o3-mini"))).toBe(promptBeast)
    expect(SystemPrompt.provider(make("gpt-5-codex"))).toBe(promptCodex)
    expect(SystemPrompt.provider(make("gpt-5"))).toBe(promptGpt)
    expect(SystemPrompt.provider(make("gemini-2.5-pro"))).toBe(promptGemini)
    expect(SystemPrompt.provider(make("trinity-v3"))).toBe(promptTrinity)
    expect(SystemPrompt.provider(make("kimi-k2"))).toBe(promptKimi)
    expect(SystemPrompt.provider(make("model", "moonshotai"))).toBe(promptKimi)
    expect(SystemPrompt.provider(make("muse-spark"))).toBe(promptMeta.replaceAll("{{MODEL_NAME}}", "Muse Spark"))
    expect(SystemPrompt.provider(make("muse-glimmer"))).toBe(promptMeta.replaceAll("{{MODEL_NAME}}", "Muse Glimmer"))
    expect(SystemPrompt.provider(make("unknown-model"))).toBe(promptDefault)
  })

  it("declares the model identity", () => {
    expect(SystemPrompt.declaration(make("fake-model", "fake"))).toBe(
      "You are powered by the model named fake-model. The exact model ID is fake/fake-model",
    )
  })
})
