export * as SessionAttachment from "./attachment"

import path from "path"
import { fileURLToPath } from "url"
import { Effect } from "effect"
import type { PromptInput } from "@opencode-ai/schema/prompt-input"
import { AbsolutePath } from "../schema"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { FileAttachment, Prompt } from "./prompt"

/** Directory listings are always model-visible text, matching the V1 attachment behavior. */
const DIRECTORY_MIME = "application/x-directory"
const TEXT_MIME = "text/plain"

/**
 * Text attachments are bounded by the read tool's paging threshold. A larger file pages instead of
 * returning its full content, which is reported as an omission rather than silently truncated.
 */
export const MAX_TEXT_ATTACHMENT_BYTES = ReadToolFileSystem.MAX_READ_BYTES
/** Media attachments are bounded by the read tool's ingest limit, which the provider also enforces. */
export const MAX_MEDIA_ATTACHMENT_BYTES = ReadToolFileSystem.MAX_MEDIA_INGEST_BYTES

type Materialized = {
  readonly uri: string
  readonly mime: string
  readonly name?: string
}

const textDataUrl = (content: string) => `data:${TEXT_MIME};base64,${Buffer.from(content, "utf8").toString("base64")}`

const basename = (value: string) => {
  const trimmed = value.replace(/[\\/]+$/, "")
  return path.basename(trimmed) || undefined
}

/**
 * `fileURLToPath` throws synchronously for host-form or otherwise malformed file URLs. Convert
 * defensively so an unreadable scheme becomes a deterministic omission instead of an admission
 * defect.
 */
const localPathFromUri = (uri: string) => {
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

const normalizeEntry = (entry: FileSystem.Entry) => {
  const name = entry.path.replace(/[\\/]+$/, "")
  return entry.type === "directory" ? `${name}/` : name
}

/**
 * Smallest deterministic listing rendering: one entry per line, directories marked with a trailing
 * slash. Ordering is directory-first then ascending by UTF-16 code unit so it never depends on the
 * host locale (`ReadTool.list` orders with `localeCompare`). No timestamps, sizes, or headers.
 */
export const renderDirectory = (entries: ReadonlyArray<FileSystem.Entry>) =>
  [...entries]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      const left = normalizeEntry(a)
      const right = normalizeEntry(b)
      return left < right ? -1 : left > right ? 1 : 0
    })
    .map(normalizeEntry)
    .join("\n")

const staticFile = (file: PromptInput.FileAttachment) => {
  const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
  return FileAttachment.make({
    uri: file.uri,
    mime: dataMime ?? FSUtil.mimeType(file.name ?? file.uri),
    ...(file.name === undefined ? {} : { name: file.name }),
    ...(file.description === undefined ? {} : { description: file.description }),
    ...(file.source === undefined ? {} : { source: file.source }),
  })
}

/** Local sources need the Location filesystem; inline `data:` attachments do not. */
export const needsFileSystem = (input: PromptInput.Prompt) =>
  (input.files ?? []).some((file) => !file.uri.startsWith("data:"))

/** Resolves prompt attachments that carry no local source, without touching the filesystem. */
export const resolveStatic = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map(staticFile),
  })

/**
 * Materializes local prompt attachments once, before durable admission. Every attachment either
 * carries inline provider-ready content or a deterministic model-visible omission; an unresolved
 * local source never survives into the admitted prompt.
 */
export const materialize = (input: PromptInput.Prompt) =>
  Effect.gen(function* () {
    if (input.files === undefined) return Prompt.make({ text: input.text, agents: input.agents })
    if (input.files.length === 0) return Prompt.make({ text: input.text, agents: input.agents, files: [] })

    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const reader = yield* ReadToolFileSystem.Service
    const cache = new Map<string, Materialized>()

    const keep = (
      file: PromptInput.FileAttachment,
      result: { readonly uri: string; readonly mime: string; readonly name?: string; readonly description?: string },
    ) =>
      FileAttachment.make({
        uri: result.uri,
        mime: result.mime,
        ...(result.name === undefined ? {} : { name: result.name }),
        ...(result.description === undefined ? {} : { description: result.description }),
        ...(file.source === undefined ? {} : { source: file.source }),
      })

    const omission = (file: PromptInput.FileAttachment, reason: string) => {
      const name = file.name ?? basename(file.uri)
      return keep(file, {
        uri: textDataUrl(`[Attachment omitted: ${name ?? "unknown"} — ${reason}]`),
        mime: TEXT_MIME,
        ...(name === undefined ? {} : { name }),
        description: reason,
      })
    }

    const materializeFile = (file: PromptInput.FileAttachment) =>
      Effect.gen(function* () {
        if (file.uri.startsWith("data:")) return staticFile(file)

        if (/^https?:\/\//i.test(file.uri)) return omission(file, "remote URL sources are not supported")

        const raw = file.uri.startsWith("file:") ? localPathFromUri(file.uri) : file.uri
        if (raw === undefined) return omission(file, "path could not be resolved inside the Location")
        const target = yield* mutation.resolve({ path: raw }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (target === undefined) return omission(file, "path could not be resolved inside the Location")
        if (target.externalDirectory !== undefined) return omission(file, "outside the Location")

        const cached = cache.get(target.canonical)
        if (cached !== undefined)
          return keep(file, { ...cached, name: file.name ?? cached.name, description: file.description })

        const absolute = AbsolutePath.make(target.canonical)
        const resource = file.name ?? raw
        const kind = yield* reader.inspect(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (kind === undefined) return omission(file, "not found or not readable")

        if (kind === "directory") {
          const page = yield* reader.list(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (page === undefined) return omission(file, "directory could not be read")
          const listing: Materialized = {
            uri: textDataUrl(renderDirectory(page.entries)),
            mime: DIRECTORY_MIME,
            name: file.name ?? basename(target.canonical),
          }
          cache.set(target.canonical, listing)
          return keep(file, { ...listing, description: file.description })
        }

        const info = yield* fs.stat(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (info === undefined) return omission(file, "not found or not readable")
        if (info.size > MAX_MEDIA_ATTACHMENT_BYTES) return omission(file, "exceeds the attachment size limit")

        const read = yield* reader.read(absolute, resource).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (read === undefined) return omission(file, "unsupported attachment type or unreadable content")
        // TextPage is only returned when the read was paged, i.e. the file exceeded the text bound.
        if (!("encoding" in read)) return omission(file, "exceeds the text attachment limit")

        const materialized: Materialized =
          read.encoding === "base64"
            ? {
                uri: `data:${read.mime};base64,${read.content}`,
                mime: read.mime,
                name: file.name ?? read.name ?? basename(target.canonical),
              }
            : { uri: textDataUrl(read.content), mime: TEXT_MIME, name: file.name ?? basename(target.canonical) }
        cache.set(target.canonical, materialized)
        return keep(file, { ...materialized, description: file.description })
      })

    const files: FileAttachment[] = []
    for (const file of input.files) files.push(yield* materializeFile(file))
    return Prompt.make({ text: input.text, agents: input.agents, files })
  })
