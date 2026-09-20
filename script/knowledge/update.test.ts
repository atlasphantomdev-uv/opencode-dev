import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { build, discover, git, parse, run, validate } from "./update"
import { topics } from "./catalog"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "knowledge-"))
  roots.push(root)
  git(root, "init")
  git(root, "config", "user.email", "test@example.invalid")
  git(root, "config", "user.name", "Test")
  for (const path of topics.flatMap((topic) => topic.paths)) {
    if (path.split("/").at(-1)!.includes(".") && !path.startsWith("."))
      put(root, path, path === "package.json" ? "{}" : "source")
    else {
      mkdirSync(join(root, path), { recursive: true })
      put(root, path + "/placeholder.ts", "export {}")
    }
  }
  put(root, "packages/example/package.json", JSON.stringify({ name: "example", scripts: { test: "bun test" } }))
  put(root, "packages/example/src/index.ts", "export const value = 1")
  git(root, "add", ".")
  git(root, "commit", "-qm", "fixture")
  return root
}
function put(root: string, path: string, value: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), value)
}
const doc = (root: string, id: string) => readFileSync(join(root, ".knowledge", id + ".md"), "utf8")

test("initial generation, durable reload, incremental edits and committed changes", () => {
  const root = fixture()
  expect(run(root, "init")).toBe(0)
  const initial = doc(root, "security")
  const module = doc(root, "module-packages-example")
  expect(run(root, "update")).toBe(0)
  expect(doc(root, "module-packages-example")).toBe(module)
  put(root, "packages/example/src/index.ts", "export const value = 2")
  expect(validate(root).some((error) => error.includes("module-packages-example"))).toBe(true)
  expect(run(root, "check")).toBe(1)
  git(root, "add", "packages/example")
  git(root, "commit", "-qm", "change")
  expect(run(root, "update")).toBe(0)
  expect(doc(root, "security")).toBe(initial)
  expect(doc(root, "module-packages-example")).not.toBe(module)
  expect(validate(root)).toEqual([])
})

test("addition, rename with spaces, deletion and package retirement", () => {
  const root = fixture()
  run(root, "init")
  put(root, "packages/example/src/new file.ts", "export {}")
  expect(run(root, "update")).toBe(0)
  renameSync(join(root, "packages/example/src/index.ts"), join(root, "packages/example/src/renamed file.ts"))
  git(root, "add", "packages/example")
  expect(git(root, "status", "--porcelain=v1")).toContain("renamed file.ts")
  expect(run(root, "update")).toBe(0)
  expect(doc(root, "module-packages-example")).not.toContain("`packages/example/src/index.ts`")
  rmSync(join(root, "packages/example"), { recursive: true })
  expect(validate(root).length).toBeGreaterThan(0)
  expect(run(root, "update")).toBe(0)
  expect(doc(root, "index")).not.toContain("module-packages-example")
})

test("deleted architecture anchors require review", () => {
  const root = fixture()
  run(root, "init")
  rmSync(join(root, "packages/core/src/session.ts"))
  expect(validate(root).some((error) => error.includes("missing source"))).toBe(true)
  expect(() => run(root, "update")).toThrow("Review moved/deleted")
})

test("malformed metadata, duplicate IDs, broken relations and edited prose fail", () => {
  const root = fixture()
  run(root, "init")
  const original = doc(root, "security")
  put(root, ".knowledge/copy.md", original)
  put(root, ".knowledge/security.md", original.replace("related: [", 'related: ["missing",'))
  put(root, ".knowledge/bad.md", "---\nname: [\n---\n")
  const errors = validate(root).join("\n")
  expect(errors).toContain("duplicate identifier")
  expect(errors).toContain("broken relationship")
  expect(errors).toContain("bad.md")
  expect(() => parse("no metadata")).toThrow()
  expect(() => parse(original.replace(/last_verified_commit: .*/, 'last_verified_commit: "bad"'))).toThrow()
})

test("ignored files, secrets, generated output and symlinks are excluded", () => {
  const root = fixture()
  put(root, ".gitignore", "private/\n")
  for (const path of [
    ".env",
    ".env.production",
    "credentials.json",
    "private/hidden.ts",
    "packages/example/src/generated/client.ts",
    "node_modules/fake/index.ts",
    "key.pem",
  ])
    put(root, path, "SECRET_SENTINEL")
  symlinkSync(join(root, "credentials.json"), join(root, "packages/example/src/link.ts"))
  git(root, "add", "-f", "private/hidden.ts", "credentials.json")
  const files = discover(root)
  expect(files.some((file) => /private|credentials|generated|node_modules|\.env|link.ts/.test(file))).toBe(false)
  expect(JSON.stringify(build(root))).not.toContain("SECRET_SENTINEL")
})

test("credential implementation changes invalidate knowledge without indexing secret values", () => {
  const root = fixture()
  put(root, "packages/core/package.json", JSON.stringify({ name: "core" }))
  for (const path of [
    "credentials.json",
    "packages/core/src/credentials.json",
    "packages/core/src/secrets.ts",
    ".env.local",
  ])
    put(root, path, "PRIVATE_VALUE_SENTINEL")
  run(root, "init")
  const unrelated = doc(root, "configuration")
  expect(discover(root)).toContain("packages/core/src/credential.ts")
  put(root, "packages/core/src/credential.ts", 'export const service = "IMPLEMENTATION_SENTINEL"')
  expect(run(root, "check")).toBe(1)
  const errors = validate(root)
  expect(errors.some((error) => error.startsWith("security.md: stale"))).toBe(true)
  expect(errors.some((error) => error.startsWith("module-packages-core.md: stale"))).toBe(true)
  expect(run(root, "update")).toBe(0)
  expect(doc(root, "configuration")).toBe(unrelated)
  expect(validate(root)).toEqual([])
  const output = build(root)
    .map((item) => doc(root, item.id))
    .join("\n")
  expect(output).not.toContain("PRIVATE_VALUE_SENTINEL")
  expect(output).not.toContain("IMPLEMENTATION_SENTINEL")
  expect(discover(root).some((path) => /credentials\.json|secrets\.ts|\.env/.test(path))).toBe(false)
})

for (const entry of [
  "packages/opencode/src/index.ts",
  "packages/app/src/entry.tsx",
  "packages/desktop/src/main/index.ts",
]) {
  test.each(["delete", "move"])(`%s of advertised entry ${entry} fails before writing knowledge`, (action) => {
    const root = fixture()
    put(root, entry, "export {}")
    run(root, "init")
    const before = build(root).map((item) => [item.id, doc(root, item.id)] as const)
    if (action === "delete") rmSync(join(root, entry))
    else renameSync(join(root, entry), join(root, entry + ".moved.ts"))
    const errors = validate(root)
    for (const name of ["index", "workflows"])
      expect(errors).toContain(`${name}.md: missing source ${entry}; review catalog`)
    expect(run(root, "check")).toBe(1)
    expect(() => run(root, "update")).toThrow("Review moved/deleted")
    for (const [id, text] of before) expect(doc(root, id)).toBe(text)
    put(root, entry, "export {}")
    expect(validate(root)).toEqual([])
  })
}

test("entry edits refresh only index and workflows, then remain stable", () => {
  const root = fixture()
  run(root, "init")
  const before = new Map(build(root).map((item) => [item.id, doc(root, item.id)]))
  put(root, "packages/app/src/entry.tsx", "export const changed = true")
  expect(run(root, "check")).toBe(1)
  expect(run(root, "update")).toBe(0)
  const changed = build(root)
    .filter((item) => doc(root, item.id) !== before.get(item.id))
    .map((item) => item.id)
    .sort()
  expect(changed).toEqual(["index", "workflows"])
  const after = build(root).map((item) => [item.id, doc(root, item.id)] as const)
  expect(run(root, "update")).toBe(0)
  for (const [id, text] of after) expect(doc(root, id)).toBe(text)
})

test.each([
  ["integrations", "packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts"],
  ["configuration", "packages/core/src/config/plugin/provider.ts"],
])("%s navigation anchor is validated", (name, path) => {
  const root = fixture()
  run(root, "init")
  expect(doc(root, name)).toContain(path)
  rmSync(join(root, path))
  expect(validate(root)).toContain(`${name}.md: missing source ${path}; review catalog`)
  expect(() => run(root, "update")).toThrow("Review moved/deleted")
})
