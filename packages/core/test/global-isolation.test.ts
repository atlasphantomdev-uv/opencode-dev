import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "./fixture/tmpdir"

/**
 * Global paths are resolved once per process, at module load, so isolation can only be observed
 * in a fresh process. These probes spawn one and read back the resolved paths.
 */
const globalModule = pathToFileURL(path.join(import.meta.dir, "..", "src", "global.ts")).href

const probe = (overrides: Record<string, string | undefined>) => {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).flatMap(([key, value]) =>
      value === undefined || key.startsWith("XDG_") || key.endsWith("_DIR") ? [] : [[key, value]],
    ),
  )
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) env[key] = value
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `const { Global } = await import(${JSON.stringify(globalModule)});` +
        `console.log(JSON.stringify({ data: Global.Path.data, cache: Global.Path.cache, state: Global.Path.state, config: Global.Path.config, bin: Global.Path.bin, log: Global.Path.log }))`,
    ],
    env,
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(`probe failed: ${result.stderr.toString()}`)
  return JSON.parse(result.stdout.toString()) as Record<string, string>
}

const app = "opencode"

describe("instance directory isolation", () => {
  test("environment overrides place every directory under the requested root", async () => {
    await using tmp = await tmpdir()
    const dirs = {
      data: path.join(tmp.path, "data"),
      state: path.join(tmp.path, "state"),
      cache: path.join(tmp.path, "cache"),
      config: path.join(tmp.path, "config"),
    }

    const paths = probe({
      OPENCODE_DATA_DIR: dirs.data,
      OPENCODE_STATE_DIR: dirs.state,
      OPENCODE_CACHE_DIR: dirs.cache,
      OPENCODE_CONFIG_DIR: dirs.config,
    })

    expect(paths.data).toBe(path.join(dirs.data, app))
    expect(paths.state).toBe(path.join(dirs.state, app))
    expect(paths.cache).toBe(path.join(dirs.cache, app))
    expect(paths.config).toBe(path.join(dirs.config, app))
    expect(paths.bin).toBe(path.join(dirs.cache, app, "bin"))
    expect(paths.log).toBe(path.join(dirs.data, app, "log"))
    // Module load creates the directories it owns, so an isolated instance is usable immediately.
    expect((await fs.stat(path.join(dirs.state, app))).isDirectory()).toBe(true)
    expect((await fs.stat(path.join(dirs.cache, app, "bin"))).isDirectory()).toBe(true)
  })

  test("omitting the overrides keeps the default xdg layout", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")

    const paths = probe({ HOME: home, OPENCODE_TEST_HOME: home })

    expect(paths.data).toBe(path.join(home, ".local", "share", app))
    expect(paths.cache).toBe(path.join(home, ".cache", app))
    expect(paths.config).toBe(path.join(home, ".config", app))
    expect(paths.state).toBe(path.join(home, ".local", "state", app))
  })

  test("two instances with different roots resolve disjoint paths", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    const overrides = (root: string) => ({
      OPENCODE_DATA_DIR: path.join(root, "data"),
      OPENCODE_STATE_DIR: path.join(root, "state"),
      OPENCODE_CACHE_DIR: path.join(root, "cache"),
    })

    const one = probe(overrides(first.path))
    const two = probe(overrides(second.path))

    expect(one.data).not.toBe(two.data)
    expect(one.state).not.toBe(two.state)
    expect(one.cache).not.toBe(two.cache)
    expect(one.data.startsWith(first.path)).toBe(true)
    expect(two.data.startsWith(second.path)).toBe(true)
  })

  test("the same environment resolves the same paths for every run", async () => {
    await using tmp = await tmpdir()
    const overrides = { OPENCODE_DATA_DIR: path.join(os.tmpdir(), "opencode-isolation-determinism") }

    expect(probe(overrides).data).toBe(probe(overrides).data)
  })
})
