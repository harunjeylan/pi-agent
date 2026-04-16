/**
 * Graphify Ingest Tool
 *
 * Add a URL to the corpus (fetch and save to ./raw).
 */

import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createStateManager, getPython } from "../utils.js";
import { ingestUrl } from "../ingest.js";

export function registerIngestTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "graphify_ingest",
    label: "Ingest URL to Corpus",
    description: "Fetch a URL and add it to the knowledge corpus. Supports web pages, tweets, arXiv papers, PDFs, images, and YouTube videos.",
    parameters: Type.Object({
      url: Type.String({
        description: "URL to fetch and add to corpus"
      }),
      author: Type.Optional(Type.String({
        description: "Author of the content (for attribution)"
      })),
      contributor: Type.Optional(Type.String({
        description: "Who added this to the corpus"
      })),
      targetPath: Type.Optional(Type.String({
        description: "Where to save (default: current working directory)"
      }))
    }),

    execute: async (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) => {
      const stateManager = createStateManager();
      stateManager.restore(ctx);
      const state = stateManager.getState();

      try {
        const targetPath = params.targetPath || ctx.cwd;

        const python = await getPython(ctx, state);
        if (!python) {
          return {
            content: [{ type: "text", text: "Error: Failed to find Python" }],
            details: { error: "Python not found" }
          };
        }

        const result = await ingestUrl(ctx, python, params.url, targetPath, {
          author: params.author,
          contributor: params.contributor
        });

        if (!result) {
          return {
            content: [{ type: "text", text: "Error: Failed to fetch URL" }],
            details: { error: "Ingest failed" }
          };
        }

        return {
          content: [{ type: "text", text: `Added: ${result}\nRun graphify_build to include in graph.` }],
          details: {
            url: params.url,
            savedTo: result,
            author: params.author,
            contributor: params.contributor
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
