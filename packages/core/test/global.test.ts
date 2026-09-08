import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/tmpdir"

/** Mirrors the env block in `script/dev.ts`. */
function devInstanceEnv(root: string) {
  return {
    OPENCODE_TEST_HOME: root,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, ".config"),
    XDG_DATA_HOME: path.join(root, ".local", "share"),
    XDG_STATE_HOME: path.join(root, ".local", "state"),
    XDG_CACHE_HOME: path.join(root, ".cache"),
  }
}

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  // `global.ts` resolves every root once at module load, so isolation has to be asserted in a
  // fresh process. This pins the contract `script/dev.ts` relies on: pointing HOME/XDG_* at an
  // instance root moves config, data (auth + session db + logs + repos), state and cache
  // together. Setting only one still leaves the others on the real instance.
  test("instance roots follow the isolation environment", async () => {
    await using directory = await tmpdir()
    const root = directory.path
    // The probe must live inside the package so `@opencode-ai/core/*` resolves.
    const probe = path.join(import.meta.dir, `global-isolation-probe.${process.pid}.ts`)
    await fs.writeFile(
      probe,
      [`import { Global } from "@opencode-ai/core/global"`, `console.log(JSON.stringify(Global.Path))`].join("\n"),
    )

    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", probe],
      cwd: path.dirname(import.meta.dir),
      // Stale XDG values from the surrounding shell must not win: `xdg-basedir` prefers them
      // over HOME, so a leaked XDG_DATA_HOME would send auth/sessions to the real instance.
      env: Object.assign(
        {},
        process.env,
        {
          XDG_CONFIG_HOME: "/should/not/be/used/.config",
          XDG_DATA_HOME: "/should/not/be/used/.local/share",
          XDG_STATE_HOME: "/should/not/be/used/.local/state",
          XDG_CACHE_HOME: "/should/not/be/used/.cache",
        },
        devInstanceEnv(root),
      ),
    })

    await fs.rm(probe, { force: true })

    expect(result.exitCode).toBe(0)
    const resolved = JSON.parse(result.stdout.toString().trim()) as Record<string, string>

    expect(resolved.home).toBe(root)
    expect(resolved.config).toBe(path.join(root, ".config", "opencode"))
    expect(resolved.data).toBe(path.join(root, ".local", "share", "opencode"))
    expect(resolved.state).toBe(path.join(root, ".local", "state", "opencode"))
    expect(resolved.cache).toBe(path.join(root, ".cache", "opencode"))
    // Derived roots must follow their parents rather than the real instance.
    expect(resolved.log).toBe(path.join(root, ".local", "share", "opencode", "log"))
    expect(resolved.repos).toBe(path.join(root, ".local", "share", "opencode", "repos"))
    expect(resolved.bin).toBe(path.join(root, ".cache", "opencode", "bin"))

    // Nothing may resolve back into the machine-wide instance.
    for (const value of [resolved.home, resolved.config, resolved.data, resolved.state, resolved.cache])
      expect(value.startsWith(root)).toBe(true)
  })
})
