/**
 * Graphify Query Tool
 *
 * Query the knowledge graph with natural language.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager, getPython } from "../utils.js";
import { queryGraph } from "../graph.js";

export function registerQueryTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_query",
    label: "Query Knowledge Graph",
    description: "Query the knowledge graph. Ask questions about code, docs, concepts. Use BFS for broad context, DFS for tracing specific paths.",
    parameters: Type.Object({
      question: Type.String({
        description: "Natural language question to ask the graph"
      }),
      mode: Type.Optional(Type.String({
        enum: ["bfs", "dfs"],
        description: "BFS for broad context, DFS for deep path tracing"
      })),
      budget: Type.Optional(Type.Number({
        description: "Token budget for answer (default: 2000)"
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

        const python = await getPython(ctx, state);
        if (!python) {
          return {
            content: [{ type: "text", text: "Error: Failed to find Python" }],
            details: { error: "Python not found" }
          };
        }

        const result = await queryGraph(ctx, python, state, params.question, {
          mode: params.mode || "bfs",
          budget: params.budget || 2000
        });

        if (!result) {
          return {
            content: [{ type: "text", text: "Query returned no results." }],
            details: { answer: null, question: params.question }
          };
        }

        return {
          content: [{ type: "text", text: result }],
          details: {
            answer: result,
            question: params.question,
            mode: params.mode || "bfs",
            graphPath
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
