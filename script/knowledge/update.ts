import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { entrypoints, topics } from "./catalog"

type Document = { id: string; paths: string[]; related: string[]; body: string; digest: string }
type Metadata = {
  type: string
  name: string
  source_paths: string[]
  related: string[]
  last_verified_commit: string
  source_digest: string
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
export function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", root, ...args])
  if (result.exitCode) throw new Error(result.stderr.toString())
  return result.stdout.toString().trimEnd()
}
// Only source-like files are fingerprinted. Contents are never embedded in generated prose.
export function eligible(path: string) {
  return (
    !/(^|\/)(\.git|\.knowledge|node_modules|vendor|dist|build|target|coverage|artifacts|generated|generated-effect|\.cache|\.turbo|\.sst)(\/|$)/.test(
      path,
    ) &&
    // Audited executable source: fingerprint its contents, but never emit them.
    (path === "packages/core/src/credential.ts" ||
      !/(^|\/)(\.env[^/]*|credentials?([.-][^/]*)?|secrets?([.-][^/]*)?|id_rsa|id_ed25519|auth\.json)$/i.test(path)) &&
    !/\.(pem|key|p12|pfx|crt|snap|svg|map|min\.js)$/i.test(path) &&
    /(^|\/)([^/]+\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|yaml|yml|toml|sql|rs|sh|lock|d2)|Dockerfile|pre-push|pre-commit|\.gitignore)$/.test(
      path,
    )
  )
}
function safe(path: string) {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    !path.split("").some((character) => character.charCodeAt(0) < 32)
  )
}
const matches = (file: string, path: string) => file === path || file.startsWith(path + "/")
export function discover(root: string) {
  const files = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0")
  const ignored = Bun.spawnSync(["git", "-C", root, "check-ignore", "--no-index", "-z", "--stdin"], {
    stdin: Buffer.from(files.filter(Boolean).join("\0") + "\0"),
  })
  if (ignored.exitCode > 1) throw new Error(ignored.stderr.toString())
  const excluded = new Set(ignored.stdout.toString().split("\0"))
  return [...new Set(files)]
    .filter(
      (file) =>
        safe(file) &&
        eligible(file) &&
        !excluded.has(file) &&
        existsSync(join(root, file)) &&
        lstatSync(join(root, file)).isFile(),
    )
    .sort()
}
export function build(root: string): Document[] {
  const files = discover(root)
  const fingerprints = new Map(files.map((file) => [file, hash(readFileSync(join(root, file)))]))
  const engine = hash(
    readFileSync(new URL(import.meta.url)) + readFileSync(new URL("catalog.ts", import.meta.url)).toString(),
  )
  function document(id: string, paths: string[], related: string[], body: string): Document {
    const selected = files.filter((file) => paths.some((path) => matches(file, path)))
    return {
      id,
      paths,
      related,
      body,
      digest: hash(
        JSON.stringify([engine, paths, related, body, selected.map((file) => [file, fingerprints.get(file)])]),
      ),
    }
  }
  const docs = topics.map((topic) =>
    document(
      topic.id,
      topic.paths,
      topic.related,
      `# ${topic.id}\n\n## Navigation notes\n\n${topic.notes}\n\nThese curated notes are review guidance, not automatically verified behavioral claims.\n\n## Source of truth\n\n${topic.paths.map((path) => `- \`${path}\``).join("\n")}\n`,
    ),
  )
  const manifests = files
    .filter((file) => /^(packages|sdks|github)\/.+\/package.json$/.test(file) || file === "github/package.json")
    .filter((file) => !file.includes("/test/") && !file.includes("/fixtures/"))
  const names = new Map(
    manifests.map((file) => [String(JSON.parse(readFileSync(join(root, file), "utf8")).name), file.slice(0, -13)]),
  )
  for (const file of manifests) {
    const pkg = JSON.parse(readFileSync(join(root, file), "utf8"))
    const directory = file.slice(0, -13)
    const id = "module-" + directory.replaceAll("/", "-")
    const dependencies = Object.keys(pkg.dependencies ?? {})
      .filter((name) => names.has(name))
      .sort()
    const entries = ["src/index.ts", "src/entry.tsx", "src/main/index.ts", "src/api.ts"]
      .map((path) => `${directory}/${path}`)
      .filter((path) => files.includes(path))
    const areas = [
      ...new Set(
        files
          .filter((path) => path.startsWith(directory + "/src/"))
          .map((path) => path.slice(directory.length + 5).split("/")[0]!),
      ),
    ].sort()
    docs.push(
      document(
        id,
        [directory],
        dependencies.map((name) => "module-" + names.get(name)!.replaceAll("/", "-")),
        `# ${directory}\n\nManifest: \`${file}\`\n\nEntry candidates: ${entries.map((path) => `\`${path}\``).join(", ") || "inspect manifest exports/bin"}\n\nWorkspace runtime dependencies: ${dependencies.join(", ") || "none declared"}\n\nTask names: ${
          Object.keys(pkg.scripts ?? {})
            .sort()
            .join(", ") || "none"
        }\n\nSource areas (${areas.length}): ${areas.slice(0, 24).join(", ")}${areas.length > 24 ? "; see source directory for remaining areas" : ""}\n`,
      ),
    )
  }
  docs.push(
    document(
      "index",
      ["package.json", ...entrypoints.map((entry) => entry.path)],
      docs.map((doc) => doc.id),
      `# OpenCode repository knowledge\n\nAI-powered development tool; Bun/TypeScript workspace undergoing V1 → V2 migration. Source and tests are authoritative. Read only the relevant focused document, then verify implementation-critical facts in source.\n\nStart: ${entrypoints.map((entry) => `${entry.name}: \`${entry.path}\``).join("; ")}.\n\n## Concerns\n\n${topics.map((topic) => `- [${topic.id}](${topic.id}.md)`).join("\n")}\n\n## Packages\n\n${docs
        .filter((doc) => doc.id.startsWith("module-"))
        .map((doc) => `- [${doc.paths[0]}](${doc.id}.md)`)
        .join(
          "\n",
        )}\n\nMaintenance: \`bun knowledge:status\`, \`bun knowledge:update\`, \`bun knowledge:validate\`. See [developer guide](../script/knowledge/README.md). Fingerprints verify source snapshots, not semantic correctness.\n`,
    ),
  )
  return docs
}
export function parse(text: string): Metadata {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) throw new Error("missing YAML frontmatter")
  // Validate every field below before returning the parsed metadata.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const value = Bun.YAML.parse(match[1]!) as Metadata
  if (
    !value ||
    value.type !== "knowledge" ||
    typeof value.name !== "string" ||
    !/^[a-z0-9-]+$/.test(value.name) ||
    !Array.isArray(value.source_paths) ||
    !value.source_paths.every((path) => typeof path === "string" && safe(path)) ||
    !Array.isArray(value.related) ||
    !value.related.every((id) => typeof id === "string") ||
    !/^[a-f0-9]{40,64}$/.test(value.last_verified_commit) ||
    !/^[a-f0-9]{64}$/.test(value.source_digest)
  )
    throw new Error("invalid frontmatter fields")
  return value
}
function render(doc: Document, commit: string) {
  const meta: Metadata = {
    type: "knowledge",
    name: doc.id,
    source_paths: doc.paths,
    related: doc.related,
    last_verified_commit: commit,
    source_digest: doc.digest,
  }
  return `---\n${Object.entries(meta)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n${doc.body}`
}
export function validate(root: string, docs = build(root), stale = true) {
  const errors: string[] = []
  const directory = join(root, ".knowledge")
  const expected = new Map(docs.map((doc) => [doc.id, doc]))
  const seen = new Set<string>()
  for (const name of existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".md")) : []) {
    try {
      const text = readFileSync(join(directory, name), "utf8")
      const meta = parse(text)
      if (seen.has(meta.name)) errors.push(`${name}: duplicate identifier ${meta.name}`)
      seen.add(meta.name)
      const doc = expected.get(meta.name)
      if (!doc || name !== `${meta.name}.md`) errors.push(`${name}: obsolete or unexpected component`)
      for (const path of meta.source_paths)
        if (!existsSync(join(root, path))) errors.push(`${name}: missing source ${path}; review catalog`)
      for (const id of meta.related) if (!expected.has(id)) errors.push(`${name}: broken relationship ${id}`)
      if (doc && (meta.source_digest !== doc.digest || text !== render(doc, meta.last_verified_commit)) && stale)
        errors.push(`${name}: stale or edited; run knowledge:update`)
    } catch (error) {
      errors.push(`${name}: ${String(error)}`)
    }
  }
  for (const doc of docs) if (!seen.has(doc.id)) errors.push(`${doc.id}: missing document`)
  return errors
}
export function run(root: string, command: string) {
  if (!["init", "update", "validate", "status", "check"].includes(command))
    throw new Error("Usage: update.ts init|update|validate|status|check")
  const docs = build(root)
  const directory = join(root, ".knowledge")
  const commit = git(root, "rev-parse", "HEAD")
  const affected = docs.filter((doc) => {
    try {
      const text = readFileSync(join(directory, doc.id + ".md"), "utf8")
      const meta = parse(text)
      return text !== render(doc, meta.last_verified_commit)
    } catch {
      return true
    }
  })
  if (command === "status" || command === "check") {
    console.log(`Affected knowledge: ${affected.map((doc) => doc.id).join(", ") || "none"}`)
    console.log(`Unchanged: ${docs.length - affected.length} documents`)
    // Porcelain v1 -z safely represents spaces and both sides of renames without shell parsing.
    console.log("Git working changes (including staged, untracked, deletions and renames):")
    console.log(
      git(root, "status", "--porcelain=v1", "-z")
        .split("\0")
        .filter(Boolean)
        .map((line) => JSON.stringify(line))
        .join("\n"),
    )
    return command === "check" && validate(root, docs).length ? 1 : 0
  }
  if (command === "init" || command === "update") {
    // Missing curated anchors are ambiguous: do not bless a moved/deleted architecture reference.
    const missing = docs.flatMap((doc) => doc.paths.filter((path) => !existsSync(join(root, path))))
    if (missing.length) throw new Error(`Review moved/deleted catalog anchors before updating: ${missing.join(", ")}`)
    mkdirSync(directory, { recursive: true })
    for (const doc of command === "init" ? docs : affected) {
      const path = join(directory, doc.id + ".md")
      writeFileSync(path + ".tmp", render(doc, commit))
      renameSync(path + ".tmp", path)
    }
    for (const name of readdirSync(directory)) {
      if (!/^module-[a-z0-9-]+\.md$/.test(name) || docs.some((doc) => name === doc.id + ".md")) continue
      // Only remove documents recognized as our own generated package inventory.
      if (parse(readFileSync(join(directory, name), "utf8")).name === name.slice(0, -3))
        unlinkSync(join(directory, name))
    }
    console.log(`Updated ${command === "init" ? docs.length : affected.length}/${docs.length} documents`)
    const review = affected.filter((doc) => topics.some((topic) => topic.id === doc.id))
    if (review.length)
      console.log(`Review curated navigation against changed source: ${review.map((doc) => doc.id).join(", ")}`)
  }
  const errors = validate(root, docs)
  for (const error of errors) console.error(error)
  if (!errors.length) console.log(`Knowledge valid (${docs.length} documents)`)
  return errors.length ? 1 : 0
}
if (import.meta.main) {
  try {
    process.exitCode = run(resolve(import.meta.dirname, "../.."), process.argv[2] ?? "status")
  } catch (error) {
    console.error(String(error))
    process.exitCode = 1
  }
}
