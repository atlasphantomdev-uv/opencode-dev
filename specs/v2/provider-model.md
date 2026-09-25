# Provider and Model Catalog

## Provider Schema

```ts
export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  statics((schema) => ({
    opencode: schema.make("opencode"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
  })),
)
export type ID = typeof ID.Type

export interface AISDK extends Schema.Schema.Type<typeof AISDK> {}
export const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(optional),
  settings: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "Provider.AISDK" })

export interface Native extends Schema.Schema.Type<typeof Native> {}
export const Native = Schema.Struct({
  type: Schema.Literal("native"),
  url: Schema.String.pipe(optional),
  settings: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "Provider.Native" })

export const Api = Schema.Union([AISDK, Native])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Provider.Api" })
export type Api = typeof Api.Type

export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Json),
}).annotate({ identifier: "Provider.Request" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  integrationID: Integration.ID.pipe(optional),
  name: Schema.String,
  disabled: Schema.Boolean.pipe(optional),
  api: Api,
  request: Request,
})
  .annotate({ identifier: "ProviderV2.Info" })
  .pipe(
    statics((schema) => ({
      empty: (id: ID) =>
        schema.make({
          id,
          name: id,
          api: { type: "native", settings: {} },
          request: { headers: {}, body: {} },
        }),
    })),
  )

// `ProviderV2.NotFound` is not present in `packages/core/src/catalog.ts`.
// Catalog provider lookup returns `undefined` instead (see Catalog Interface below).
```

## Model Schema

```ts
export const ID = Schema.String.pipe(Schema.brand("ModelV2.ID"))
export type ID = typeof ID.Type

export const VariantID = Schema.String.pipe(Schema.brand("VariantID"))
export type VariantID = typeof VariantID.Type

export const Family = Schema.String.pipe(Schema.brand("Family"))
export type Family = typeof Family.Type

export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.String.pipe(Schema.Array),
  output: Schema.String.pipe(Schema.Array),
})
export type Capabilities = typeof Capabilities.Type

// Variants are inlined into `ModelV2.Info` as
// `variants: Array<{ id: VariantID, ...Provider.Request.fields }>`.
// There is no standalone `Variant` schema; `VariantID` remains a brand.

export const Cost = Schema.Struct({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(Schema.optional),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})
export type Cost = typeof Cost.Type

export const Limit = Schema.Struct({
  context: Schema.Int,
  input: Schema.Int.pipe(Schema.optional),
  output: Schema.Int,
})
export type Limit = typeof Limit.Type

export const Ref = Schema.Struct({
  id: ID,
  providerID: ProviderV2.ID,
  variant: VariantID.pipe(Schema.optional),
})
export type Ref = typeof Ref.Type

export const Api = Schema.Union([
  Schema.Struct({ id: ID, ...Provider.AISDK.fields }),
  Schema.Struct({ id: ID, ...Provider.Native.fields }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Model.Api" })
export type Api = typeof Api.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  family: Family.pipe(optional),
  name: Schema.String,
  api: Api,
  capabilities: Capabilities,
  request: Schema.Struct({
    ...Provider.Request.fields,
    variant: Schema.String.pipe(optional),
  }),
  variants: Schema.Struct({
    id: VariantID,
    ...Provider.Request.fields,
  }).pipe(Schema.Array),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Schema.Array(Cost),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: Schema.Int.pipe(optional),
    output: Schema.Int,
  }),
})
  .annotate({ identifier: "ModelV2.Info" })
  .pipe(
    statics((schema) => ({
      empty: (providerID: Provider.ID, modelID: ID) =>
        schema.make({
          id: modelID,
          providerID,
          name: modelID,
          api: { id: modelID, type: "native", settings: {} },
          capabilities: { tools: false, input: [], output: [] },
          request: { headers: {}, body: {} },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 0, output: 0 },
        }),
    })),
  )
```

## Catalog Interface

```ts
export interface Interface extends State.Transformable<Draft> {
  readonly provider: {
    readonly get: (providerID: ProviderV2.ID) => Effect.Effect<ProviderV2.Info | undefined>
    readonly all: () => Effect.Effect<ProviderV2.Info[]>
    readonly available: () => Effect.Effect<ProviderV2.Info[]>
  }

  readonly model: {
    readonly get: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => Effect.Effect<ModelV2.Info | undefined>
    readonly all: () => Effect.Effect<ModelV2.Info[]>
    readonly available: () => Effect.Effect<ModelV2.Info[]>
    readonly default: () => Effect.Effect<ModelV2.Info | undefined>
    readonly small: (providerID: ProviderV2.ID) => Effect.Effect<ModelV2.Info | undefined>
  }
}
```

`ProviderV2.Info.disabled` is stored provider state. Provider plugins leave it unset (available) or set it to `true` to exclude the provider.

`ProviderV2.Api` is the tagged union `aisdk | native`; there is no `unknown` endpoint. `CatalogV2.model.get()` and `CatalogV2.model.all()` project each stored model against its provider's `api` and `request` before returning it.

Model storage is nested by provider because model ids are only unique within a provider.

```ts
type ProviderRecord = {
  provider: ProviderV2.MutableInfo
  models: Map<ModelV2.ID, ModelV2.MutableInfo>
}
```

`ModelV2.Info.enabled` stores model availability. `CatalogV2.model.available()` also requires a usable provider. A provider is usable when it is not `disabled`, exposes a request body `apiKey`, has an active integration connection, or has no integration at all.

```ts
const available = (provider: ProviderV2.Info, integration: Integration.Info | undefined) => {
  if (provider.disabled) return false
  if (typeof provider.request.body.apiKey === "string") return true
  if (integration?.connections.length) return true
  return provider.integrationID === undefined && !integration
}
```

## Current Session Runner Adaptation

The first local V2 Session runner waits for Location plugin boot, then resolves an explicit Session model without silently falling back. Without an explicit model it uses a supported Location catalog default, then falls back to the first available model with a supported route, and otherwise fails with `SessionRunnerModel.ModelNotSelectedError`. Its native adaptation surface is deliberately narrow:

```text
aisdk:@ai-sdk/openai -> openai/responses over HTTP
aisdk:@ai-sdk/anthropic -> anthropic/messages
aisdk:@ai-sdk/google -> gemini
aisdk:@ai-sdk/xai -> openai/responses over HTTP
aisdk:@openrouter/ai-sdk-provider -> openrouter
aisdk:@ai-sdk/cerebras -> openai-compatible chat
aisdk:@ai-sdk/deepinfra -> openai-compatible chat
aisdk:@ai-sdk/groq -> openai-compatible chat
aisdk:@ai-sdk/togetherai -> openai-compatible chat
aisdk:@ai-sdk/openai-compatible with an explicit URL -> openai-compatible chat
```

Model `api.url`, when present, is used as the LLM route base URL. The adapter preserves model headers and body options, direct model API keys and resolved integration credentials, and selected Session variant overlays.

Unsupported routes fail explicitly with `SessionRunnerModel.UnsupportedApiError`. Azure, Bedrock, GitHub Copilot, Vertex, gateway adapters, and signed authentication remain future provider slices.

## Plugin Interface

Current `PluginV2.Interface` only supports registration and load coordination; it does not expose hooks or triggers:

```ts
export const ID = Plugin.ID
export type ID = typeof ID.Type

export interface Interface {
  readonly add: (id: ID, effect: PluginRuntime["effect"]) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
  readonly wait: (id: ID) => Effect.Effect<void>
}
```

Plugin modules are declared with the internal `define({ id, effect })` helper in `packages/core/src/plugin/internal.ts`, not a public `PluginV2.Definition`. The internal boot layer supplies required services to each plugin effect.

### Planned: typed hooks (not implemented)

The account hook algebra and `Definition` below are design intent only. No `HookSpec`, `HookFunctions`, `Definition`, or `Interface.trigger` exists in the current source.

```ts
type HookSpec = {
  "account.update": {
    input: {
      id: AccountV2.ID
      serviceID: AccountV2.ServiceID
    }
    output: {
      description: string
      credential: AccountV2.Credential
      cancel: boolean
    }
  }

  "account.remove": {
    input: {
      account: AccountV2.Info
    }
    output: {
      cancel: boolean
    }
  }

  "account.activate": {
    input: {}
    output: {
      from?: AccountV2.ID
      to: AccountV2.ID
      cancel: boolean
    }
  }

  "account.activated": {
    input: {
      from?: AccountV2.ID
      to: AccountV2.ID
    }
    output: {}
  }
}

export type Definition<R = never> = Effect.Effect<
  {
    readonly order: number
    readonly hooks: HookFunctions
  },
  never,
  R
>
```

## Plugin Order

Planned, not implemented. There is no numeric `Order` map in the current source; boot order is the explicit sequence in `packages/core/src/plugin/internal.ts`.

```ts
export const Order = {
  modelsDev: 0,
  env: 10,
  account: 20,
  provider: 30,
  config: 40,
  discovery: 50,
} as const
```

## Built-In Plugins

Current built-ins are the internal boot plugins plus the provider plugin list:

- Config plugins (`packages/core/src/config/plugin/`): `ConfigReferencePlugin`, `ConfigAgentPlugin`, `ConfigSkillPlugin`, `ConfigExternalPlugin`, `ConfigProviderPlugin`.
- Core plugins (`packages/core/src/plugin/`): `AgentPlugin`, `CommandPlugin`, `SkillPlugin`, `ModelsDevPlugin`, `EnvPlugin` (exists; does not expose an `Env.Service`), `VariantPlugin`.
- Provider plugins (`packages/core/src/plugin/provider/`): Alibaba, AmazonBedrock, Anthropic, Azure, AzureCognitiveServices, Cerebras, CloudflareAIGateway, CloudflareWorkersAI, Cohere, DeepInfra, Gateway, GithubCopilot, GitLab, Google, GoogleVertex, GoogleVertexAnthropic, Groq, Kilo, LLMGateway, Mistral, Nvidia, Opencode, SnowflakeCortex, OpenAICompatible, OpenAI, OpenRouter, Perplexity, SapAICore, TogetherAI, Vercel, Venice, XAI, Zenmux, DynamicProvider.

Not implemented: there is no `AccountPlugin` (`AccountV2` in `packages/core/src/account.ts` is types-only, with no Service or layer) and no `GitLabDiscoveryPlugin` (only `GitLabPlugin` in `packages/core/src/plugin/provider/gitlab.ts`).

## Plugin Hooks

Planned, not implemented. The `init`, `provider.update`, and `model.update` hooks below do not exist in the current source.

```ts
export type Hooks = {
  init: {}

  "provider.update": {
    provider: Draft<ProviderV2.Info>
    cancel: boolean
  }

  "model.update": {
    model: Draft<ModelV2.Info>
    cancel: boolean
  }
}
```
