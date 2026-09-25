import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { DateTime, Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { RelativePath } from "@opencode-ai/core/schema"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      FSUtil.node,
      LayerNodePlatform.filesystem,
      Location.node,
      LocationMutation.node,
      ReadToolFileSystem.node,
    ]),
    [[Location.node, tempLocationLayer]],
  ),
)

const model = Model.make({ id: "model", provider: "provider", route: OpenAIChat.route })
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])

const fixture = Effect.gen(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  return { directory: location.directory, fs }
})

const decode = (uri: string) => {
  expect(uri.startsWith("data:text/plain;base64,")).toBe(true)
  return Buffer.from(uri.slice("data:text/plain;base64,".length), "base64").toString("utf8")
}

describe("SessionAttachment.materialize", () => {
  it.effect("materializes a local text file as inline text", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      yield* fs.writeWithDirs(path.join(directory, "note.md"), "hello world")
      const prompt = yield* SessionAttachment.materialize({
        text: "read this",
        files: [
          {
            uri: path.join(directory, "note.md"),
            name: "note.md",
            source: { start: 0, end: 9, text: "@note.md" },
          },
        ],
      })
      const file = prompt.files?.[0]
      expect(file?.mime).toBe("text/plain")
      expect(file?.name).toBe("note.md")
      expect(file?.source).toEqual({ start: 0, end: 9, text: "@note.md" })
      expect(decode(file?.uri ?? "")).toBe("hello world")
    }),
  )

  it.effect("materializes a directory as a deterministic listing", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      yield* fs.ensureDir(path.join(directory, "nested"))
      yield* fs.writeWithDirs(path.join(directory, "b.txt"), "b")
      yield* fs.writeWithDirs(path.join(directory, "a.txt"), "a")
      const prompt = yield* SessionAttachment.materialize({
        text: "list",
        files: [{ uri: path.join(directory, "") }],
      })
      const file = prompt.files?.[0]
      expect(file?.mime).toBe("application/x-directory")
      expect(decode(file?.uri ?? "")).toBe("nested/\na.txt\nb.txt")
    }),
  )

  test("renders directory entries directory-first then by code unit", () => {
    const entry = (value: string, type: "file" | "directory") =>
      FileSystem.Entry.make({ path: RelativePath.make(value), type })
    expect(
      SessionAttachment.renderDirectory([
        entry("z.txt", "file"),
        entry(`dir${path.sep}`, "directory"),
        entry("A.txt", "file"),
        entry(`other${path.sep}`, "directory"),
      ]),
    ).toBe("dir/\nother/\nA.txt\nz.txt")
  })

  it.effect("materializes a supported local image as inline media", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      const file = path.join(directory, "pixel.png")
      yield* fs.writeWithDirs(file, png)
      const prompt = yield* SessionAttachment.materialize({ text: "look", files: [{ uri: file }] })
      const attachment = prompt.files?.[0]
      expect(attachment?.mime).toBe("image/png")
      expect(attachment?.uri.startsWith("data:image/png;base64,")).toBe(true)
      expect(attachment?.name).toBe("pixel.png")
    }),
  )

  it.effect("preserves an already supplied data: media attachment", () =>
    Effect.gen(function* () {
      const prompt = yield* SessionAttachment.materialize({
        text: "look",
        files: [{ uri: "data:image/png;base64,aGVsbG8=", name: "hello.png" }],
      })
      expect(prompt.files?.[0]).toEqual({ uri: "data:image/png;base64,aGVsbG8=", name: "hello.png", mime: "image/png" })
    }),
  )

  it.effect("omits a missing source with deterministic text", () =>
    Effect.gen(function* () {
      const { directory } = yield* fixture
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: path.join(directory, "missing.txt"), name: "missing.txt" }],
      })
      const attachment = prompt.files?.[0]
      expect(attachment?.mime).toBe("text/plain")
      expect(decode(attachment?.uri ?? "")).toBe("[Attachment omitted: missing.txt — not found or not readable]")
      expect(attachment?.description).toBe("not found or not readable")
    }),
  )

  it.effect("omits an external source without reading it", () =>
    Effect.gen(function* () {
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: "/etc/hosts", name: "hosts" }],
      })
      const attachment = prompt.files?.[0]
      expect(decode(attachment?.uri ?? "")).toBe("[Attachment omitted: hosts — outside the Location]")
    }),
  )

  it.effect("omits a malformed host-form file URI without defecting admission", () =>
    Effect.gen(function* () {
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: "file://remotehost/etc/hosts", name: "hosts" }],
      })
      const attachment = prompt.files?.[0]
      expect(attachment?.mime).toBe("text/plain")
      expect(decode(attachment?.uri ?? "")).toBe(
        "[Attachment omitted: hosts — path could not be resolved inside the Location]",
      )
      const messages = toLLMMessages(
        [
          SessionMessage.User.make({
            id: SessionMessage.ID.make("msg_malformed"),
            type: "user",
            text: "prompt",
            files: prompt.files,
            time: { created: DateTime.makeUnsafe(0) },
          }),
        ],
        model,
      )
      expect(messages[0]?.content).toEqual([
        { type: "text", text: "prompt" },
        { type: "text", text: "[Attachment omitted: hosts — path could not be resolved inside the Location]" },
      ])
    }),
  )

  it.effect("materializes a valid local file: URI", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      const file = path.join(directory, "uri.txt")
      yield* fs.writeWithDirs(file, "from uri")
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: pathToFileURL(file).href, name: "uri.txt" }],
      })
      expect(prompt.files?.[0]?.mime).toBe("text/plain")
      expect(decode(prompt.files?.[0]?.uri ?? "")).toBe("from uri")
    }),
  )

  it.effect("omits an unsupported attachment type", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      const file = path.join(directory, "archive.zip")
      yield* fs.writeWithDirs(file, "not really a zip")
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: file, name: "archive.zip" }],
      })
      expect(decode(prompt.files?.[0]?.uri ?? "")).toBe(
        "[Attachment omitted: archive.zip — unsupported attachment type or unreadable content]",
      )
    }),
  )

  it.effect("omits a text source above the bounded limit", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      const file = path.join(directory, "large.txt")
      yield* fs.writeWithDirs(file, "a".repeat(SessionAttachment.MAX_TEXT_ATTACHMENT_BYTES + 1))
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: file, name: "large.txt" }],
      })
      expect(decode(prompt.files?.[0]?.uri ?? "")).toBe(
        "[Attachment omitted: large.txt — exceeds the text attachment limit]",
      )
    }),
  )

  it.effect("derives a name and preserves ordering for anonymous sources", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      yield* fs.writeWithDirs(path.join(directory, "one.txt"), "one")
      yield* fs.writeWithDirs(path.join(directory, "two.txt"), "two")
      const prompt = yield* SessionAttachment.materialize({
        text: "read",
        files: [{ uri: path.join(directory, "one.txt") }, { uri: path.join(directory, "two.txt") }],
      })
      expect(prompt.files?.map((file) => file.name)).toEqual(["one.txt", "two.txt"])
      expect(prompt.files?.map((file) => decode(file.uri))).toEqual(["one", "two"])
    }),
  )

  it.effect("materializes a duplicated source once and keeps each mention span", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      const file = path.join(directory, "dup.txt")
      yield* fs.writeWithDirs(file, "dup")
      const prompt = yield* SessionAttachment.materialize({
        text: "read twice",
        files: [
          { uri: file, source: { start: 0, end: 8, text: "@dup.txt" } },
          { uri: file, source: { start: 9, end: 17, text: "@dup.txt" } },
        ],
      })
      expect(prompt.files?.length).toBe(2)
      expect(prompt.files?.[0]?.uri).toBe(prompt.files?.[1]?.uri)
      expect(prompt.files?.map((item) => item.source?.start)).toEqual([0, 9])
    }),
  )

  it.effect("does not reread the source after materialization", () =>
    Effect.gen(function* () {
      const { directory, fs } = yield* fixture
      const file = path.join(directory, "gone.txt")
      yield* fs.writeWithDirs(file, "before")
      const prompt = yield* SessionAttachment.materialize({ text: "read", files: [{ uri: file }] })
      yield* fs.remove(file)
      expect(decode(prompt.files?.[0]?.uri ?? "")).toBe("before")
    }),
  )
})

describe("attachment lowering", () => {
  const user = (files: SessionMessage.User["files"]) =>
    SessionMessage.User.make({
      id: SessionMessage.ID.make("msg_attach"),
      type: "user",
      text: "prompt",
      files,
      time: { created: DateTime.makeUnsafe(0) },
    })

  test("lowers a materialized text attachment to provider text", () => {
    const messages = toLLMMessages(
      [user([{ uri: "data:text/plain;base64,aGVsbG8=", mime: "text/plain", name: "note.md" }])],
      model,
    )
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "prompt" },
      { type: "text", text: "hello" },
    ])
  })

  test("lowers a materialized directory attachment to provider text", () => {
    const messages = toLLMMessages(
      [user([{ uri: "data:text/plain;base64,b25lLw==", mime: "application/x-directory" }])],
      model,
    )
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "prompt" },
      { type: "text", text: "one/" },
    ])
  })

  test("never lowers an unresolved local source into provider media", () => {
    const messages = toLLMMessages(
      [user([{ uri: "file:///work/readme.md", mime: "text/markdown", name: "readme.md" }])],
      model,
    )
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "prompt" },
      { type: "text", text: "[Attachment unavailable: readme.md]" },
    ])
  })

  test("never lowers an unresolved media source into provider media", () => {
    const messages = toLLMMessages([user([{ uri: "/work/pixel.png", mime: "image/png", name: "pixel.png" }])], model)
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "prompt" },
      { type: "text", text: "[Attachment unavailable: pixel.png]" },
    ])
  })
})
