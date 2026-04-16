/**
 * Graphify Build Tool
 * 
 * Build or rebuild knowledge graph from code/docs.
 */

import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager, getPython, ensureGraphify } from "../utils.js";
import { detectFiles, buildGraph, exportGraph } from "../graph.js";

export function registerBuildTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_build",
    label: "Build Knowledge Graph",
    description: "Build knowledge graph from directory. Analyzes code, docs, and creates queryable graph.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({
        description: "Directory path to analyze (default: current working directory)"
      })),
      mode: Type.Optional(Type.String({
        enum: ["normal", "deep"],
        description: "Extraction mode - deep for richer INFERRED edges"
      })),
      directed: Type.Optional(Type.Boolean({
        description: "Build directed graph (preserves edge direction)"
      })),
      update: Type.Optional(Type.Boolean({
        description: "Incremental update - only process changed files"
      })),
      exports: Type.Optional(Type.Array(Type.String({
        enum: ["svg", "graphml", "neo4j", "wiki"]
      }), {
        description: "Additional export formats"
      }))
    }),

    execute: async (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) => {
      const targetPath = params.path || ctx.cwd;
      const stateManager = createStateManager();
      stateManager.restore(ctx);
      const state = stateManager.getState();

      try {
        const python = await getPython(ctx, state);
        if (!python) {
          return {
            content: [{ type: "text", text: "Error: Failed to find Python" }],
            details: { error: "Python not found" }
          };
        }

        const hasGraphify = await ensureGraphify(ctx, python);
        if (!hasGraphify) {
          return {
            content: [{ type: "text", text: "Error: Failed to install graphify" }],
            details: { error: "graphify installation failed" }
          };
        }

        const detectResult = await detectFiles(ctx, python, targetPath);
        if (!detectResult) {
          return {
            content: [{ type: "text", text: "Error: Detection failed" }],
            details: { error: "Detection failed" }
          };
        }

        if (detectResult.total_files === 0) {
          return {
            content: [{ type: "text", text: "Error: No supported files found" }],
            details: { error: "No files to process" }
          };
        }

        const result = await buildGraph(ctx, python, targetPath, {
          mode: params.mode as "normal" | "deep" | undefined,
          directed: params.directed,
          update: params.update
        });

        if (!result) {
          return {
            content: [{ type: "text", text: "Error: Graph build failed" }],
            details: { error: "Build failed" }
          };
        }

        state.lastGraphPath = result.outputDir;
        stateManager.persist(ctx, pi);

        if (params.exports && params.exports.length > 0) {
          await exportGraph(ctx, python, targetPath, {
            svg: params.exports.includes("svg"),
            graphml: params.exports.includes("graphml"),
            neo4j: params.exports.includes("neo4j"),
            wiki: params.exports.includes("wiki")
          });
        }

        const summary = `Graph built successfully!
- ${result.nodes} nodes, ${result.edges} edges
- ${result.communities} communities
- ${detectResult.total_files} files analyzed
- Output: ${result.outputDir}`;

        return {
          content: [{ type: "text", text: summary }],
          details: {
            nodes: result.nodes,
            edges: result.edges,
            communities: result.communities,
            outputDir: result.outputDir,
            filesDetected: detectResult.total_files,
            wordsDetected: detectResult.total_words
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
