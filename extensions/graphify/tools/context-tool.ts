/**
 * Graphify Context Tool
 *
 * Get context for a file - related files, concepts, documentation.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager } from "../utils.js";

export function registerContextTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_context",
    label: "Get File Context",
    description: "Get context for a file. Returns related files, connected concepts, relevant documentation, and community membership. Essential for understanding code in context.",
    parameters: Type.Object({
      filePath: Type.String({
        description: "Path to the file to analyze"
      }),
      depth: Type.Optional(Type.Number({
        description: "How many hops to traverse (1-3, default: 2)"
      })),
      graphPath: Type.Optional(Type.String({
        description: "Path to graph.json (auto-detected if not provided)"
      }))
    }),

    execute: async (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) => {
      const stateManager = createStateManager();
      stateManager.restore(ctx);
      const state = stateManager.getState();

      try {
        let graphPath = params.graphPath;
        if (!graphPath) {
          const candidates = [
            state.lastGraphPath ? join(state.lastGraphPath, "graph.json") : null,
            join(ctx.cwd, "graphify-out", "graph.json"),
            join(ctx.cwd, "graph.json")
          ].filter(Boolean) as string[];

          for (const p of candidates) {
            if (existsSync(p)) {
              graphPath = p;
              break;
            }
          }
        }

        if (!graphPath || !existsSync(graphPath)) {
          return {
            content: [{ type: "text", text: "Error: No graph found. Run graphify_build first." }],
            details: { error: "No graph found" }
          };
        }

        const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
        const nodes = graph.nodes || [];
        const edges = graph.links || graph.edges || [];

        const fileNode = nodes.find((n: any) =>
          n.file === params.filePath ||
          n.id === params.filePath ||
          n.id?.endsWith(params.filePath)
        );

        if (!fileNode) {
          return {
            content: [{ type: "text", text: `Error: File not found in graph: ${params.filePath}. Run graphify_build to include it.` }],
            details: { error: "File not found", filePath: params.filePath }
          };
        }

        const depth = Math.min(Math.max(params.depth || 2, 1), 3);
        const context = gatherContext(fileNode, nodes, edges, depth);

        const summary = `Context for ${params.filePath}:
- Type: ${fileNode.type}
- Community: ${fileNode.community}
- Related files: ${context.relatedFiles.length}
- Connected concepts: ${context.concepts.length}
- Inbound refs: ${context.inbound.length}
- Outbound refs: ${context.outbound.length}`;

        return {
          content: [{ type: "text", text: summary }],
          details: {
            file: params.filePath,
            node: {
              id: fileNode.id,
              label: fileNode.label,
              type: fileNode.type,
              community: fileNode.community
            },
            community: context.community,
            relatedFiles: context.relatedFiles,
            connectedConcepts: context.concepts,
            inboundReferences: context.inbound,
            outboundReferences: context.outbound,
            godNodesInCommunity: context.godNodes
          }
        };

      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
          details: { error: String(err) }
        };
      }
    }
  });
}

function gatherContext(fileNode: any, nodes: any[], edges: any[], depth: number) {
  const relatedFiles = new Set<string>();
  const concepts = new Set<string>();
  const inbound: any[] = [];
  const outbound: any[] = [];

  const community = nodes.filter((n: any) =>
    n.community === fileNode.community && n.id !== fileNode.id
  );

  const visited = new Set<string>();
  const queue: { nodeId: string; dist: number }[] = [{ nodeId: fileNode.id, dist: 0 }];

  while (queue.length > 0) {
    const { nodeId, dist } = queue.shift()!;
    if (visited.has(nodeId) || dist > depth) continue;
    visited.add(nodeId);

    for (const edge of edges) {
      const source = edge.source?.id || edge.source;
      const target = edge.target?.id || edge.target;

      if (source === nodeId && !visited.has(target)) {
        const targetNode = nodes.find((n: any) => n.id === target);
        if (targetNode) {
          if (targetNode.type === "file" || targetNode.type === "document") {
            relatedFiles.add(targetNode.file || targetNode.id);
          } else {
            concepts.add(targetNode.label || targetNode.id);
          }
          outbound.push({ node: targetNode.label || target, type: edge.type });
          if (dist < depth) {
            queue.push({ nodeId: target, dist: dist + 1 });
          }
        }
      }

      if (target === nodeId && !visited.has(source)) {
        const sourceNode = nodes.find((n: any) => n.id === source);
        if (sourceNode) {
          if (sourceNode.type === "file" || sourceNode.type === "document") {
            relatedFiles.add(sourceNode.file || sourceNode.id);
          }
          inbound.push({ node: sourceNode.label || source, type: edge.type });
        }
      }
    }
  }

  const communityNodes = nodes.filter((n: any) => n.community === fileNode.community);
  const godNodes = communityNodes
    .map((n: any) => ({
      ...n,
      edgeCount: edges.filter((e: any) =>
        (e.source?.id || e.source) === n.id ||
        (e.target?.id || e.target) === n.id
      ).length
    }))
    .sort((a: any, b: any) => b.edgeCount - a.edgeCount)
    .slice(0, 5);

  return {
    community: community.slice(0, 20).map((n: any) => ({
      label: n.label,
      type: n.type
    })),
    relatedFiles: Array.from(relatedFiles).slice(0, 10),
    concepts: Array.from(concepts).slice(0, 15),
    inbound: inbound.slice(0, 10),
    outbound: outbound.slice(0, 10),
    godNodes: godNodes.map((n: any) => ({
      label: n.label,
      type: n.type,
      connections: n.edgeCount
    }))
  };
}
