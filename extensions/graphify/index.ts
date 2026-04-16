/**
 * Graphify Extension for PI Agent
 *
 * Turns code, docs, PDFs, images into a queryable knowledge graph.
 * Based on: https://github.com/safishamsi/graphify
 *
 * Usage:
 *   /graphify                          # build graph from current directory
 *   /graphify <path>                   # build graph from specific path
 *   /graphify <path> --mode deep       # deep extraction mode
 *   /graphify <path> --update          # incremental update
 *   /graphify <path> --directed        # directed graph
 *   /graphify <path> --svg             # export SVG
 *   /graphify <path> --graphml         # export GraphML
 *   /graphify <path> --neo4j           # export Neo4j cypher
 *   /graphify <path> --neo4j-push bolt://localhost:7687  # push to Neo4j
 *   /graphify <path> --wiki            # generate wiki
 *   /graphify <path> --obsidian --obsidian-dir ~/vault  # copy to Obsidian
 *   /graphify <path> --mcp             # start MCP server
 *   /graphify <path> --watch           # watch mode
 *   /graphify add <url>                # fetch URL
 *   /graphify query "question"         # query the graph
 *   /graphify query "question" --dfs   # DFS mode
 *   /graphify path "A" "B"             # find path between concepts
 *   /graphify explain "Concept"        # explain a concept
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerGraphifyTools } from "./tools/index.js";
import {
  createStateManager,
  getPython,
  ensureGraphify,
  parseFullArgs,
} from "./utils.js";
import {
  detectFiles,
  buildGraph,
  queryGraph,
  findPath,
  explainNode,
  exportGraph,
} from "./graph.js";
import { ingestUrl } from "./ingest.js";
import { startWatch, stopWatch } from "./watch.js";
import type { GraphResult } from "./types.js";

export default function GraphifyExtension(pi: ExtensionAPI) {
  const stateManager = createStateManager();

  // Register agent-callable tools
  registerGraphifyTools(pi);

  // Register /graphify command
  pi.registerCommand("graphify", {
    description: "Build and query knowledge graphs from code/docs",
    handler: async (args, ctx) => {
      stateManager.restore(ctx);
      const state = stateManager.getState();

      // Ensure graphify is available
      const python = await getPython(ctx, state);
      if (!python) {
        ctx.ui.notify(" Failed to find Python", "error");
        return;
      }

      const hasGraphify = await ensureGraphify(ctx, python);
      if (!hasGraphify) {
        ctx.ui.notify(" Failed to install graphify", "error");
        return;
      }

      const argArray = args ? args.split(" ").filter((a) => a) : [];
      const parsed = parseFullArgs(argArray, ctx.cwd);

      // Handle subcommands
      if (parsed.subcommand === "query") {
        const question = parsed.rest.join(" ");
        if (!question) {
          ctx.ui.notify(" Usage: /graphify query <question>", "warning");
          return;
        }
        const isDfs = parsed.rest.includes("--dfs");
        const budgetIdx = parsed.rest.indexOf("--budget");
        const budget =
          budgetIdx >= 0 ? parseInt(parsed.rest[budgetIdx + 1]) || 2000 : 2000;
        const cleanQuestion = question
          .replace(/--dfs|--budget \d+/g, "")
          .trim();

        const result = await queryGraph(ctx, python, state, cleanQuestion, {
          mode: isDfs ? "dfs" : "bfs",
          budget,
        });
        if (result) {
          ctx.ui.notify(result, "info");
        }
        return;
      }

      if (parsed.subcommand === "path") {
        const [from, to] = parsed.rest;
        if (!from || !to) {
          ctx.ui.notify(" Usage: /graphify path <from> <to>", "warning");
          return;
        }
        const result = await findPath(ctx, python, state, from, to);
        if (result) {
          ctx.ui.notify(result, "info");
        }
        return;
      }

      if (parsed.subcommand === "explain") {
        const nodeName = parsed.rest.join(" ");
        if (!nodeName) {
          ctx.ui.notify(" Usage: /graphify explain <concept>", "warning");
          return;
        }
        const result = await explainNode(ctx, python, state, nodeName);
        if (result) {
          ctx.ui.notify(result, "info");
        }
        return;
      }

      if (parsed.subcommand === "add") {
        const url = parsed.rest[0];
        if (!url) {
          ctx.ui.notify(" Usage: /graphify add <url>", "warning");
          return;
        }

        const authorIdx = parsed.rest.indexOf("--author");
        const contributorIdx = parsed.rest.indexOf("--contributor");
        const author = authorIdx >= 0 ? parsed.rest[authorIdx + 1] : undefined;
        const contributor =
          contributorIdx >= 0 ? parsed.rest[contributorIdx + 1] : undefined;

        const result = await ingestUrl(ctx, python, url, parsed.path, {
          author,
          contributor,
        });
        if (result) {
          ctx.ui.notify(` Added: ${result}`, "info");
          ctx.ui.notify(" Run /graphify to rebuild graph", "info");
        }
        return;
      }

      // Default: build graph
      const targetPath = parsed.path;

      // Watch mode
      if (parsed.watch) {
        const rebuild = async () => {
          ctx.ui.notify(" Rebuilding graph...", "info");
          await runBuild(ctx, python, targetPath, parsed, stateManager, pi);
        };
        startWatch(ctx, targetPath, rebuild);
        return;
      }

      // Detect first
      ctx.ui.notify(" Detecting files...", "info");
      const detectResult = await detectFiles(ctx, python, targetPath);
      if (!detectResult) {
        ctx.ui.notify(" Detection failed", "error");
        return;
      }

      // Show detection summary
      const summary = [
        `Found ${detectResult.total_files} files (~${detectResult.total_words?.toLocaleString() || 0} words)`,
      ];
      if (detectResult.files?.code?.length) {
        summary.push(`  Code: ${detectResult.files.code.length} files`);
      }
      if (detectResult.files?.document?.length) {
        summary.push(`  Docs: ${detectResult.files.document.length} files`);
      }
      if (detectResult.files?.paper?.length) {
        summary.push(`  Papers: ${detectResult.files.paper.length} files`);
      }
      if (detectResult.files?.image?.length) {
        summary.push(`  Images: ${detectResult.files.image.length} files`);
      }
      if (detectResult.files?.video?.length) {
        summary.push(`  Videos: ${detectResult.files.video.length} files`);
      }
      ctx.ui.notify(summary.join("\n"), "info");

      if (detectResult.total_files === 0) {
        ctx.ui.notify(" No supported files found", "warning");
        return;
      }

      // Build graph
      const result = await runBuild(
        ctx,
        python,
        targetPath,
        parsed,
        stateManager,
        pi,
      );

      if (!result) {
        return;
      }

      // Handle exports
      if (
        parsed.svg ||
        parsed.graphml ||
        parsed.neo4j ||
        parsed.neo4jPush ||
        parsed.wiki ||
        parsed.obsidianDir
      ) {
        await exportGraph(ctx, python, targetPath, {
          svg: parsed.svg,
          graphml: parsed.graphml,
          neo4j: parsed.neo4j,
          neo4jPush: parsed.neo4jPush,
          wiki: parsed.wiki,
          obsidianDir: parsed.obsidianDir,
          noViz: parsed.noViz,
        });
      }
    },
  });

  // Restore state on session start
  pi.on("session_start", async (_event, ctx) => {
    stateManager.restore(ctx);
  });

  // Restore state when navigating
  pi.on("session_tree", async (_event, ctx) => {
    stateManager.restore(ctx);
  });

  // Cleanup on exit
  pi.on("session_shutdown", async () => {
    stopWatch();
  });
}

async function runBuild(
  ctx: any,
  python: string,
  targetPath: string,
  parsed: any,
  stateManager: any,
  pi: ExtensionAPI,
): Promise<GraphResult | null> {
  const result = await buildGraph(ctx, python, targetPath, {
    mode: parsed.mode,
    directed: parsed.directed,
    update: parsed.update,
  });

  if (result) {
    // Update state
    const currentState = stateManager.getState();
    currentState.lastGraphPath = result.outputDir;
    stateManager.persist(ctx, pi);

    const msg = [
      `Graph complete:`,
      `  ${result.nodes} nodes, ${result.edges} edges`,
      `  ${result.communities} communities`,
      ``,
      `Outputs:`,
      `  ${result.outputDir}/graph.html`,
      `  ${result.outputDir}/GRAPH_REPORT.md`,
      `  ${result.outputDir}/graph.json`,
    ];
    ctx.ui.notify(msg.join("\n"), "info");

    // Try to show report summary
    const reportPath = join(result.outputDir, "GRAPH_REPORT.md");
    if (existsSync(reportPath)) {
      const report = readFileSync(reportPath, "utf-8");
      const godNodesMatch = report.match(/## God Nodes[\s\S]*?(?=##|$)/);
      const surprisesMatch = report.match(
        /## Surprising Connections[\s\S]*?(?=##|$)/,
      );
      if (godNodesMatch || surprisesMatch) {
        ctx.ui.notify("--- Graph Report Highlights ---", "info");
        if (godNodesMatch)
          ctx.ui.notify(godNodesMatch[0].slice(0, 1000), "info");
        if (surprisesMatch)
          ctx.ui.notify(surprisesMatch[0].slice(0, 1000), "info");
      }
    }
  }

  return result;
}
