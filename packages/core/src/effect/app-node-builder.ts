import { buildLocationServiceMap } from "../location-services"
import { LocationServiceMap } from "../location-service-map"
import { LspV2 } from "../lsp"
import { McpV2 } from "../mcp"
import { LayerNode } from "./layer-node"
import { makeGlobalNode } from "./app-node"

/**
 * Host capabilities default to no-ops. A graph that names an MCP or LSP host placeholder without
 * shipping one still resolves the rest of the Location services; the Location map repeats this for
 * the Location tree, which a graph reaches through `LocationServiceMap` rather than node by node.
 */
const hostDefaults: LayerNode.Replacements = [
  [McpV2.hostNode, McpV2.disabledHostNode],
  [LspV2.hostNode, LspV2.disabledHostNode],
]

export function build<A, E>(root: LayerNode.Node<A, E, any>, replacements: LayerNode.Replacements = []) {
  let allReplacements: LayerNode.Replacements = replacements

  // Only build the location service map if it's actually needed
  if (LayerNode.hasUnbound(root, LocationServiceMap.node) && !hasReplacement(replacements, LocationServiceMap.node)) {
    const locationMap = buildLocationServiceMap(replacements)
    const locationMapNode = makeGlobalNode({ service: LocationServiceMap.Service, layer: locationMap, deps: [] })
    allReplacements = replacements.concat([[LocationServiceMap.node, locationMapNode]])
  }

  for (const [source, fallback] of hostDefaults)
    if (LayerNode.hasUnbound(root, source) && !hasReplacement(allReplacements, source))
      allReplacements = allReplacements.concat([[source, fallback]])

  return LayerNode.compile(root, allReplacements)
}

function hasReplacement(replacements: LayerNode.Replacements, node: LayerNode.Node<unknown, unknown, any>) {
  return replacements.some(([source]) => source.name === node.name)
}

export * as AppNodeBuilder from "./app-node-builder"
