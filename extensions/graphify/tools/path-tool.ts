/**
 * Graphify Path Tool
 *
 * Find shortest path between two concepts in the graph.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager, getPython } from "../utils.js";
import { findPath } from "../graph.js";

export function registerPathTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_path",
    label: "Find Path Between Concepts",
    description: "Find the shortest path between two concepts in the knowledge graph. Shows how they connect through the codebase.",
    parameters: Type.Object({
      from: Type.String({
        description: "Starting concept (function, class, file, etc.)"
      }),
      to: Type.String({
        description: "Target concept to reach"
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

        const python = await getPython(ctx, state);
        if (!python) {
          return {
            content: [{ type: "text", text: "Error: Failed to find Python" }],
            details: { error: "Python not found" }
          };
        }

        const result = await findPath(ctx, python, state, params.from, params.to);

        if (!result) {
          return {
            content: [{ type: "text", text: `No path found between "${params.from}" and "${params.to}"` }],
            details: { error: "No path found", from: params.from, to: params.to }
          };
        }

        return {
          content: [{ type: "text", text: result }],
          details: {
            from: params.from,
            to: params.to,
            path: result,
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
