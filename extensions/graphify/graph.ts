import * as path from "node:path";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  DetectResult,
  GraphResult,
  BuildOptions,
  QueryOptions,
  ExportOptions,
} from "./types.js";
import { getPythonDir } from "./utils.js";

export async function detectFiles(
  ctx: ExtensionContext,
  python: string,
  targetPath: string
): Promise<DetectResult | null> {
  const outputDir = join(targetPath, "graphify-out");
  mkdirSync(outputDir, { recursive: true });

  const scriptPath = join(getPythonDir(), "detect.py");

  return new Promise((resolve) => {
    const proc = spawn(python, [scriptPath, targetPath], { cwd: ctx.cwd });
    let output = "";
    let error = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.stderr?.on("data", (d) => (error += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        ctx.ui.notify(` Detection failed: ${error}`, "error");
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output) as DetectResult;
        resolve(result);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function buildGraph(
  ctx: ExtensionContext,
  python: string,
  targetPath: string,
  options: BuildOptions = {}
): Promise<GraphResult | null> {
  const outputDir = join(targetPath, "graphify-out");
  mkdirSync(outputDir, { recursive: true });

  ctx.ui.notify(" Building knowledge graph...", "info");

  const scriptPath = join(getPythonDir(), "build.py");
  const args = [scriptPath, targetPath, outputDir];

  if (options.mode === "deep") {
    args.push("--mode", "deep");
  }
  if (options.directed) {
    args.push("--directed");
  }

  return new Promise((resolve) => {
    const proc = spawn(python, args, { cwd: ctx.cwd });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        ctx.ui.notify(" Graph build failed", "error");
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output) as GraphResult;
        resolve(result);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function exportGraph(
  ctx: ExtensionContext,
  python: string,
  targetPath: string,
  options: ExportOptions
): Promise<boolean> {
  const graphPath = join(targetPath, "graphify-out", "graph.json");
  
  if (!existsSync(graphPath)) {
    ctx.ui.notify(" No graph found. Run /graphify first.", "error");
    return false;
  }

  const outputDir = join(targetPath, "graphify-out");
  let success = true;

  // Export SVG
  if (options.svg) {
    ctx.ui.notify(" Exporting SVG...", "info");
    const svgPath = join(outputDir, "graph.svg");
    await new Promise<void>((resolve) => {
      const proc = spawn(python, [
        join(getPythonDir(), "export.py"),
        graphPath,
        svgPath,
        "--svg"
      ], { cwd: ctx.cwd });
      proc.on("close", (code) => {
        if (code === 0) {
          ctx.ui.notify(` SVG: ${svgPath}`, "info");
        } else {
          ctx.ui.notify(" SVG export failed", "warning");
          success = false;
        }
        resolve();
      });
    });
  }

  // Export GraphML
  if (options.graphml) {
    ctx.ui.notify(" Exporting GraphML...", "info");
    const graphmlPath = join(outputDir, "graph.graphml");
    await new Promise<void>((resolve) => {
      const proc = spawn(python, [
        join(getPythonDir(), "export.py"),
        graphPath,
        graphmlPath,
        "--graphml"
      ], { cwd: ctx.cwd });
      proc.on("close", (code) => {
        if (code === 0) {
          ctx.ui.notify(` GraphML: ${graphmlPath}`, "info");
        } else {
          ctx.ui.notify(" GraphML export failed", "warning");
          success = false;
        }
        resolve();
      });
    });
  }

  // Export Neo4j
  if (options.neo4j || options.neo4jPush) {
    ctx.ui.notify(" Exporting to Neo4j...", "info");
    const cypherPath = join(outputDir, "cypher.txt");
    const args = [
      join(getPythonDir(), "neo4j_export.py"),
      graphPath,
      cypherPath
    ];
    
    if (options.neo4jPush) {
      args.push("--push", options.neo4jPush);
    }
    
    await new Promise<void>((resolve) => {
      const proc = spawn(python, args, { cwd: ctx.cwd });
      proc.on("close", (code) => {
        if (code === 0) {
          ctx.ui.notify(` Cypher: ${cypherPath}`, "info");
          if (options.neo4jPush) {
            ctx.ui.notify(` Pushed to Neo4j`, "info");
          }
        } else {
          ctx.ui.notify(" Neo4j export failed", "warning");
          success = false;
        }
        resolve();
      });
    });
  }

  // Generate Wiki
  if (options.wiki) {
    ctx.ui.notify(" Generating wiki...", "info");
    const wikiDir = join(outputDir, "wiki");
    await new Promise<void>((resolve) => {
      const proc = spawn(python, [
        join(getPythonDir(), "wiki.py"),
        graphPath,
        wikiDir
      ], { cwd: ctx.cwd });
      proc.on("close", (code) => {
        if (code === 0) {
          ctx.ui.notify(` Wiki: ${wikiDir}`, "info");
        } else {
          ctx.ui.notify(" Wiki generation failed", "warning");
          success = false;
        }
        resolve();
      });
    });
  }

  // Copy to Obsidian vault
  if (options.obsidianDir) {
    ctx.ui.notify(` Copying to Obsidian vault...`, "info");
    const { copyToObsidian } = await import("./obsidian.js");
    await copyToObsidian(targetPath, options.obsidianDir, ctx);
  }

  return success;
}

export async function queryGraph(
  ctx: ExtensionContext,
  python: string,
  state: { lastGraphPath?: string },
  question: string,
  options: QueryOptions = {}
): Promise<string | null> {
  // Try state first, then cwd, then common locations
  let graphPath: string | null = null;
  const possiblePaths = [
    state.lastGraphPath ? join(state.lastGraphPath, "graph.json") : null,
    join(ctx.cwd, "graphify-out", "graph.json"),
    join(ctx.cwd, "graph.json"),
  ].filter(Boolean) as string[];
  
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      graphPath = p;
      break;
    }
  }
  
  if (!graphPath) {
    return "No graph found. Run /graphify first.";
  }

  const mode = options.mode || "bfs";
  const budget = options.budget || 2000;

  const scriptPath = join(getPythonDir(), "query.py");

  return new Promise((resolve) => {
    const proc = spawn(python, [scriptPath, graphPath, question, mode, String(budget)], {
      cwd: ctx.cwd,
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.on("close", () => {
      resolve(output.trim() || null);
    });
  });
}

export async function findPath(
  ctx: ExtensionContext,
  python: string,
  state: { lastGraphPath?: string },
  from: string,
  to: string
): Promise<string | null> {
  // Try state first, then cwd, then common locations
  let graphPath: string | null = null;
  const possiblePaths = [
    state.lastGraphPath ? join(state.lastGraphPath, "graph.json") : null,
    join(ctx.cwd, "graphify-out", "graph.json"),
    join(ctx.cwd, "graph.json"),
  ].filter(Boolean) as string[];
  
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      graphPath = p;
      break;
    }
  }
  
  if (!graphPath) {
    return "No graph found. Run /graphify first.";
  }

  const scriptPath = join(getPythonDir(), "path.py");

  return new Promise((resolve) => {
    const proc = spawn(python, [scriptPath, graphPath, from, to], { cwd: ctx.cwd });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.on("close", () => {
      resolve(output.trim() || null);
    });
  });
}

export async function explainNode(
  ctx: ExtensionContext,
  python: string,
  state: { lastGraphPath?: string },
  nodeName: string
): Promise<string | null> {
  // Query for node explanation with context
  const query = `Explain what "${nodeName}" is and how it connects to other concepts in the codebase.`;
  return queryGraph(ctx, python, state, query, { mode: "bfs", budget: 1500 });
}
