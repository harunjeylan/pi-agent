/**
 * Graphify Explain Tool
 *
 * Explain a concept by querying the graph for its definition and relationships.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager, getPython } from "../utils.js";
import { explainNode } from "../graph.js";

export function registerExplainTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_explain",
    label: "Explain Concept",
    description: "Explain a concept from the knowledge graph. Returns definition, relationships, and context.",
    parameters: Type.Object({
      concept: Type.String({
        description: "Concept name to explain (function, class, document, etc.)"
      }),
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

        const conceptNode = nodes.find((n: any) =>
          n.label?.toLowerCase() === params.concept.toLowerCase() ||
          n.id?.toLowerCase().includes(params.concept.toLowerCase())
        );

        if (!conceptNode) {
          const fuzzyMatches = nodes.filter((n: any) =>
            n.label?.toLowerCase().includes(params.concept.toLowerCase())
          ).slice(0, 5);

          if (fuzzyMatches.length > 0) {
            const suggestions = fuzzyMatches.map((n: any) => n.label).join(", ");
            return {
              content: [{ type: "text", text: `Concept "${params.concept}" not found. Did you mean: ${suggestions}?` }],
              details: { error: "Not found", suggestions: fuzzyMatches.map((n: any) => n.label) }
            };
          }
          return {
            content: [{ type: "text", text: `Concept "${params.concept}" not found in graph.` }],
            details: { error: "Not found" }
          };
        }

        const python = await getPython(ctx, state);
        if (!python) {
          return {
            content: [{ type: "text", text: "Error: Failed to find Python" }],
            details: { error: "Python not found" }
          };
        }

        const explanation = await explainNode(ctx, python, state, params.concept);

        const relationships = edges
          .filter((e: any) => {
            const source = e.source?.id || e.source;
            const target = e.target?.id || e.target;
            return source === conceptNode.id || target === conceptNode.id;
          })
          .map((e: any) => {
            const source = e.source?.id || e.source;
            const target = e.target?.id || e.target;
            const otherId = source === conceptNode.id ? target : source;
            const otherNode = nodes.find((n: any) => n.id === otherId);
            return {
              direction: source === conceptNode.id ? "outgoing" : "incoming",
              type: e.type,
              relatedTo: otherNode?.label || otherId,
              relatedType: otherNode?.type
            };
          });

        const summary = `${params.concept} (${conceptNode.type})
Community: ${conceptNode.community}
Relationships: ${relationships.length}

${explanation || "No detailed explanation available."}`;

        return {
          content: [{ type: "text", text: summary }],
          details: {
            concept: params.concept,
            node: {
              id: conceptNode.id,
              label: conceptNode.label,
              type: conceptNode.type,
              file: conceptNode.file,
              line: conceptNode.line,
              community: conceptNode.community
            },
            explanation: explanation || "No detailed explanation available.",
            relationships: relationships.slice(0, 20),
            relationshipCount: relationships.length
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
