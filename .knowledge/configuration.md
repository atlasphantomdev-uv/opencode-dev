---
type: "knowledge"
name: "configuration"
source_paths: ["package.json","bun.lock","turbo.json","sst.config.ts","infra","packages/core/src/config.ts","packages/core/src/config","packages/core/src/flag","packages/opencode/src/config","packages/opencode/src/config/config.ts","packages/opencode/src/provider/provider.ts","packages/core/src/config/plugin/provider.ts","packages/core/src/plugin/internal.ts"]
related: ["security","workflows"]
last_verified_commit: "e9f3a1384a9f5dbcd006d589d40a6b9d58f4ea83"
source_digest: "bb2cbe77dc255515a1e86b2a3db0e53e8f582a7f0942e5dc89624df0b8465275"
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
