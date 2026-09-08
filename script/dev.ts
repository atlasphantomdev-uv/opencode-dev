#!/usr/bin/env bun

// Launches the development CLI against an isolated instance root so it never reads or
// writes the machine's global opencode state (config, data/auth/sessions, state, cache).
//
// Uses the isolation env vars opencode already supports rather than adding a second
// configuration system. `Global.Path` resolves each root independently:
//   - config <- XDG_CONFIG_HOME (or OPENCODE_CONFIG_DIR)
//   - data   <- XDG_DATA_HOME   (or OPENCODE_DATA_DIR)   -- auth.json, mcp-auth.json, session db, logs, repos
//   - state  <- XDG_STATE_HOME  (or OPENCODE_STATE_DIR)
//   - cache  <- XDG_CACHE_HOME  (or OPENCODE_CACHE_DIR)  -- bin
//   - home   <- OPENCODE_TEST_HOME (pins os.homedir(), which drives ~/.opencode discovery)
// so all of them have to be redirected together; setting only one still leaves the rest
// pointing at the real instance. This mirrors the env block in
// `packages/opencode/test/lib/cli-process.ts`.
//
// Override the root with OPENCODE_DEV_ROOT. Without this launcher the CLI keeps its normal
// global behavior.

import { $ } from "bun"
import path from "path"

const root = process.env["OPENCODE_DEV_ROOT"] ?? path.join(import.meta.dir, "..", ".dev-instance")

const env = {
  ...process.env,
  OPENCODE_TEST_HOME: root,
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, ".config"),
  XDG_DATA_HOME: path.join(root, ".local", "share"),
  XDG_STATE_HOME: path.join(root, ".local", "state"),
  XDG_CACHE_HOME: path.join(root, ".cache"),
  TMPDIR: path.join(root, "tmp"),
}

console.error(`[dev] isolated instance root: ${root}`)

await $`bun run --cwd packages/opencode --conditions=browser src/index.ts ${process.argv.slice(2)}`
  .cwd(path.join(import.meta.dir, ".."))
  .env(env)
