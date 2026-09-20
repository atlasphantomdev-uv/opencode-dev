import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LspV2 } from "@opencode-ai/core/lsp"
import { McpV2 } from "@opencode-ai/core/mcp"
import { LspCapability } from "@/lsp/capability"
import { McpCapability } from "@/mcp/capability"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"

/**
 * Node and layer replacements for every graph this package builds or synthesizes.
 *
 * The V2 Location services get the v1 MCP, LSP, and instance bootstrap runtimes here, never by
 * importing them into Core. The capabilities are replaced as layers, not nodes: they run v1 code
 * inside an instance, and the instance store is global — as a node the Location tree would hoist and
 * rebuild it per Location, while a layer takes it from the application graph that provides it.
 */
export const hostReplacements: LayerNode.Replacements = [
  [InstanceStore.bootstrapNode, InstanceBootstrap.node],
  [LspV2.hostNode, LspCapability.layer],
  [McpV2.hostNode, McpCapability.layer],
]

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  return AppNodeBuilder.build(root, replacements.concat(hostReplacements))
}

export * as AppNodeBuilderV1 from "./app-node-builder-v1"
