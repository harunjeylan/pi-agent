/**
 * Graphify Analyze Tool
 *
 * Analyze the knowledge graph for insights: gaps, surprises, god nodes, bridges.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager } from "../utils.js";

export function registerAnalyzeTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_analyze",
    label: "Analyze Knowledge Graph",
    description: "Analyze the knowledge graph. Get god nodes (core abstractions), surprising connections (cross-community bridges), documentation gaps, or community structure.",
    parameters: Type.Object({
      type: Type.String({
        enum: ["gaps", "surprises", "god_nodes", "communities", "bridges"],
        description: "Type of analysis to perform"
      }),
      limit: Type.Optional(Type.Number({
        description: "Maximum results to return (default: 10)"
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
        const limit = params.limit || 10;

        switch (params.type) {
          case "god_nodes":
            return analyzeGodNodes(nodes, edges, limit);

          case "surprises":
          case "bridges":
            return analyzeBridges(nodes, edges, limit);

          case "communities":
            return analyzeCommunities(nodes, edges, limit);

          case "gaps":
            return analyzeGaps(nodes, edges, limit);

          default:
            return {
              content: [{ type: "text", text: `Error: Unknown analysis type: ${params.type}` }],
              details: { error: "Unknown type" }
            };
        }

      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
          details: { error: String(err) }
        };
      }
    }
  });
}

function analyzeGodNodes(nodes: any[], edges: any[], limit: number) {
  const nodeConnectivity = nodes.map(node => {
    const edgeCount = edges.filter(e => {
      const source = e.source?.id || e.source;
      const target = e.target?.id || e.target;
      return source === node.id || target === node.id;
    }).length;
    return { ...node, edgeCount };
  });

  const godNodes = nodeConnectivity
    .filter(n => n.edgeCount > 0)
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, limit);

  const summary = `Top ${godNodes.length} God Nodes (most connected):\n` +
    godNodes.map(n => `- ${n.label} (${n.type}): ${n.edgeCount} connections`).join("\n");

  return {
    content: [{ type: "text", text: summary }],
    details: {
      type: "god_nodes",
      description: "Most connected nodes - core abstractions in the knowledge graph",
      nodes: godNodes.map(n => ({
        label: n.label,
        type: n.type,
        community: n.community,
        connections: n.edgeCount,
        file: n.file
      }))
    }
  };
}

function analyzeBridges(nodes: any[], edges: any[], limit: number) {
  const bridges = edges
    .map(edge => {
      const source = edge.source?.id || edge.source;
      const target = edge.target?.id || edge.target;
      const sourceNode = nodes.find(n => n.id === source);
      const targetNode = nodes.find(n => n.id === target);

      if (sourceNode && targetNode && sourceNode.community !== targetNode.community) {
        return {
          from: sourceNode.label || source,
          to: targetNode.label || target,
          fromCommunity: sourceNode.community,
          toCommunity: targetNode.community,
          type: edge.type,
          fromFile: sourceNode.file,
          toFile: targetNode.file
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, limit);

  const summary = `${bridges.length} Surprising Connections (cross-community bridges):\n` +
    bridges.map((b: any) => `- ${b.from} → ${b.to} (bridges community ${b.fromCommunity} → ${b.toCommunity})`).join("\n");

  return {
    content: [{ type: "text", text: summary }],
    details: {
      type: "surprising_connections",
      description: "Connections that bridge different communities - unexpected relationships",
      bridges
    }
  };
}

function analyzeCommunities(nodes: any[], edges: any[], limit: number) {
  const communities: Record<number, any[]> = {};
  for (const node of nodes) {
    const comm = node.community || 0;
    if (!communities[comm]) communities[comm] = [];
    communities[comm].push(node);
  }

  const communityStats = Object.entries(communities)
    .map(([commId, members]) => {
      const memberIds = new Set(members.map(m => m.id));
      const internalEdges = edges.filter(e => {
        const source = e.source?.id || e.source;
        const target = e.target?.id || e.target;
        return memberIds.has(source) && memberIds.has(target);
      }).length;

      const totalEdges = edges.filter(e => {
        const source = e.source?.id || e.source;
        const target = e.target?.id || e.target;
        return memberIds.has(source) || memberIds.has(target);
      }).length;

      return {
        community: parseInt(commId),
        nodeCount: members.length,
        internalEdges,
        externalEdges: totalEdges - internalEdges,
        cohesion: totalEdges > 0 ? internalEdges / totalEdges : 0,
        topNodes: members
          .slice(0, 5)
          .map(n => ({ label: n.label, type: n.type }))
      };
    })
    .sort((a, b) => b.nodeCount - a.nodeCount)
    .slice(0, limit);

  const summary = `${communityStats.length} Communities:\n` +
    communityStats.map(c =>
      `- Community ${c.community}: ${c.nodeCount} nodes, ${Math.round(c.cohesion * 100)}% cohesion`
    ).join("\n");

  return {
    content: [{ type: "text", text: summary }],
    details: {
      type: "communities",
      description: "Communities detected in the graph - clusters of related concepts",
      totalCommunities: Object.keys(communities).length,
      communities: communityStats
    }
  };
}

function analyzeGaps(nodes: any[], edges: any[], limit: number) {
  const gaps = [];

  const connectedIds = new Set();
  for (const edge of edges) {
    connectedIds.add(edge.source?.id || edge.source);
    connectedIds.add(edge.target?.id || edge.target);
  }

  const isolatedNodes = nodes
    .filter(n => !connectedIds.has(n.id))
    .slice(0, limit);

  if (isolatedNodes.length > 0) {
    gaps.push({
      type: "isolated_nodes",
      description: "Nodes with no connections - may be missing links or documentation",
      nodes: isolatedNodes.map(n => ({
        label: n.label,
        type: n.type,
        file: n.file
      }))
    });
  }

  const communityCounts: Record<number, number> = {};
  for (const node of nodes) {
    const comm = node.community || 0;
    communityCounts[comm] = (communityCounts[comm] || 0) + 1;
  }

  const smallCommunities = Object.entries(communityCounts)
    .filter(([_, count]) => count <= 2)
    .slice(0, limit);

  if (smallCommunities.length > 0) {
    gaps.push({
      type: "thin_communities",
      description: "Small communities with ≤2 nodes - may be noise or need more connections",
      communities: smallCommunities.map(([comm, count]) => ({
        community: parseInt(comm),
        nodeCount: count
      }))
    });
  }

  const summary = gaps.map(g => `${g.type}: ${g.description}`).join("\n");

  return {
    content: [{ type: "text", text: summary || "No major gaps detected." }],
    details: {
      type: "gaps",
      description: "Potential issues in the knowledge graph",
      gaps
    }
  };
}
