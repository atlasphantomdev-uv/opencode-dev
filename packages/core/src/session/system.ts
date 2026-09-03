export * as SystemPrompt from "./system"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_META from "./prompt/meta.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Model } from "@opencode-ai/llm"

/**
 * Selects the provider base prompt for a model, mirroring the v1 model-family
 * mapping. Used as the fallback when the selected agent defines no system
 * prompt; an explicit agent system replaces it instead of concatenating.
 */
export const provider = (model: Model) => {
  if (model.id.includes("muse")) {
    const name = model.id.includes("muse-glimmer") ? "Muse Glimmer" : "Muse Spark"
    return PROMPT_META.replaceAll("{{MODEL_NAME}}", name)
  }
  if (model.id.includes("gpt-4") || model.id.includes("o1") || model.id.includes("o3")) return PROMPT_BEAST
  if (model.id.includes("gpt")) {
    if (model.id.includes("codex")) {
      return PROMPT_CODEX
    }
    return PROMPT_GPT
  }
  if (model.id.includes("gemini-")) return PROMPT_GEMINI
  if (model.id.includes("claude")) return PROMPT_ANTHROPIC
  if (model.id.toLowerCase().includes("trinity")) return PROMPT_TRINITY
  if (
    model.id.toLowerCase().includes("kimi") ||
    ["kimi-for-coding", "moonshotai", "moonshotai-cn"].includes(model.provider)
  )
    return PROMPT_KIMI
  return PROMPT_DEFAULT
}

/** Model identity declaration included on every request, independent of agent system presence. */
export const declaration = (model: Model) =>
  `You are powered by the model named ${model.id}. The exact model ID is ${model.provider}/${model.id}`
