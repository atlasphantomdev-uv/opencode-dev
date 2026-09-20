import { describe, expect } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { McpV2 } from "@opencode-ai/core/mcp"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import { MCP } from "../../src/mcp"
import { McpCapability } from "../../src/mcp/capability"
import { InstanceStore } from "../../src/project/instance-store"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make("/project")

let instructions: MCP.ServerInstructions[] = []
let tools: Record<string, MCP.McpTool> = {}
const provided: string[] = []

const client = (result: unknown) => ({ callTool: async () => result }) as unknown as MCP.McpTool["client"]

const mcpTool = (name: string, description?: string): MCP.McpTool => ({
  def: {
    name,
    description,
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  client: client({ content: [] }),
})

const mcp = Layer.mock(MCP.Service, {
  instructions: () => Effect.sync(() => instructions),
  tools: () => Effect.sync(() => tools),
})

const instances = Layer.mock(InstanceStore.Service, {
  provide: (input, effect) => Effect.sync(() => provided.push(input.directory)).pipe(Effect.andThen(effect)),
})

const events = Layer.mock(EventV2.Service, { subscribe: () => Stream.empty })

const env = McpCapability.layer.pipe(Layer.provide(Layer.mergeAll(mcp, instances, events)))
const it = testEffect(env)

const reset = () => {
  instructions = []
  tools = {}
  provided.length = 0
}

describe("McpCapability", () => {
  it.effect("advertises each server through the host accessor for the requested directory", () =>
    Effect.gen(function* () {
      reset()
      instructions = [{ name: "fake", instructions: "Use the fake server.", tools: ["mcp__fake__shot"] }]
      const host = yield* McpV2.Host

      expect(yield* host.servers(directory)).toEqual([
        { name: "fake", instructions: "Use the fake server.", tools: ["mcp__fake__shot"] },
      ])
      expect(provided).toEqual(["/project"])
    }),
  )

  it.effect("projects an MCP tool into the host's own schema and model content", () =>
    Effect.gen(function* () {
      reset()
      const blob = Buffer.from("pdf").toString("base64")
      tools = {
        mcp__fake__shot: {
          def: mcpTool("screenshot", "Take a screenshot").def,
          client: client({
            content: [
              { type: "text", text: "hello" },
              { type: "image", mimeType: "image/png", data: "AAAA" },
              { type: "resource", resource: { uri: "file:///report.pdf", mimeType: "application/pdf", blob } },
              { type: "resource", resource: { uri: "file:///big.bin", mimeType: "application/x-unknown", blob } },
            ],
          }),
        },
      }
      const host = yield* McpV2.Host

      const advertised = yield* host.tools(directory)
      expect(advertised.map((tool) => tool.name)).toEqual(["mcp__fake__shot"])
      expect(advertised[0]).toMatchObject({
        description: "Take a screenshot",
        jsonSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      })
      expect(yield* advertised[0]!.execute({ text: "hi" })).toEqual([
        { type: "text", text: "hello" },
        { type: "file", data: "AAAA", mime: "image/png" },
        { type: "file", data: blob, mime: "application/pdf", name: "file:///report.pdf" },
        {
          type: "text",
          text: "[Binary MCP resource omitted: file:///big.bin (application/x-unknown, 3 B) is not a supported attachment type]",
        },
      ])
    }),
  )

  it.effect("reports a refused remote call as a tool failure", () =>
    Effect.gen(function* () {
      reset()
      tools = {
        mcp__fake__shot: {
          def: mcpTool("screenshot").def,
          client: {
            callTool: async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
          } as unknown as MCP.McpTool["client"],
        },
      }
      const host = yield* McpV2.Host

      const advertised = yield* host.tools(directory)
      const exit = yield* advertised[0]!.execute({}).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ message: "boom" })
    }),
  )

  it.effect("advertises no tools and no servers without configuration", () =>
    Effect.gen(function* () {
      reset()
      const host = yield* McpV2.Host

      expect(yield* host.tools(directory)).toEqual([])
      expect(yield* host.servers(directory)).toEqual([])
    }),
  )
})
