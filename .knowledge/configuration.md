---
type: "knowledge"
name: "configuration"
source_paths: ["package.json","bun.lock","turbo.json","sst.config.ts","infra","packages/core/src/config.ts","packages/core/src/config","packages/core/src/flag","packages/opencode/src/config","packages/opencode/src/config/config.ts","packages/opencode/src/provider/provider.ts","packages/core/src/config/plugin/provider.ts","packages/core/src/plugin/internal.ts"]
related: ["security","workflows"]
last_verified_commit: "eef36e3bfba5342598a380ad5af045ecfac2389a"
source_digest: "d7efa1423488a7d21678c19e38577bab47feb887913d158d2fae2393e7c5da58"
---

# configuration

## Navigation notes

Root package.json owns Bun workspace/catalog versions and commands. Turbo coordinates package tasks. SST/infra define deployment resources. Core and legacy opencode have distinct configuration paths during migration. V2 provider/model flow: `packages/core/src/config.ts` → `packages/core/src/config/plugin/provider.ts` (`ConfigProviderPlugin` consumes Config.entries and transforms integrations/catalog). `packages/core/src/plugin/internal.ts` registers this consumer after provider/external plugins. Legacy flow: `packages/opencode/src/config/config.ts` → `packages/opencode/src/provider/provider.ts` (`config.get`, cfg.provider and cfg.model). Read schemas/loaders for supported settings; knowledge never stores environment or secret values.

These curated notes are review guidance, not automatically verified behavioral claims.

## Source of truth

- `package.json`
- `bun.lock`
- `turbo.json`
- `sst.config.ts`
- `infra`
- `packages/core/src/config.ts`
- `packages/core/src/config`
- `packages/core/src/flag`
- `packages/opencode/src/config`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/core/src/config/plugin/provider.ts`
- `packages/core/src/plugin/internal.ts`
