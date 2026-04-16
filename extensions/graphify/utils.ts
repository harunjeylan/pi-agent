import * as path from "node:path";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { GraphifyState, ParsedArgs } from "./types.js";

export interface StateManager {
  getState(): GraphifyState;
  persist(ctx: ExtensionContext, pi: ExtensionAPI): void;
  restore(ctx: ExtensionContext): void;
}

export function createStateManager(): StateManager {
  let state: GraphifyState = {};

  return {
    getState() {
      return state;
    },
    persist(ctx: ExtensionContext, pi: ExtensionAPI) {
      pi.appendEntry<GraphifyState>("graphify-state", state);
    },
    restore(ctx: ExtensionContext) {
      const branchEntries = ctx.sessionManager.getBranch();
      for (const entry of branchEntries) {
        if (entry.type === "custom" && entry.customType === "graphify-state") {
          state = (entry.data as GraphifyState) || {};
        }
      }
    },
  };
}

export async function getPython(
  ctx: ExtensionContext,
  state: GraphifyState
): Promise<string | null> {
  if (state.pythonExecutable && existsSync(state.pythonExecutable)) {
    return state.pythonExecutable;
  }

  // Try to find graphify
  const graphifyBin = await new Promise<string | null>((resolve) => {
    const proc = spawn("which", ["graphify"]);
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.on("close", (code) => {
      resolve(code === 0 ? output.trim() : null);
    });
  });

  if (graphifyBin) {
    try {
      const shebang = readFileSync(graphifyBin, "utf-8").split("\n")[0];
      const python = shebang.replace("#!", "").trim();
      if (python && !python.match(/[^a-zA-Z0-9\/_.-]/)) {
        state.pythonExecutable = python;
        return python;
      }
    } catch {}
  }

  // Default to python3
  state.pythonExecutable = "python3";
  return "python3";
}

export async function ensureGraphify(
  ctx: ExtensionContext,
  python: string
): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(python, ["-c", "import graphify"]);
      proc.on("close", (code) => {
        code === 0 ? resolve() : reject();
      });
    });
    return true;
  } catch {
    // Install graphify
    ctx.ui.notify(" Installing graphify package...", "info");
    return new Promise((resolve) => {
      const proc = spawn(python, ["-m", "pip", "install", "graphifyy", "-q"]);
      proc.on("close", (code) => {
        resolve(code === 0);
      });
    });
  }
}

export interface FullParsedArgs extends ParsedArgs {
  mode: "normal" | "deep";
  directed: boolean;
  update: boolean;
  clusterOnly: boolean;
  noViz: boolean;
  svg: boolean;
  graphml: boolean;
  neo4j: boolean;
  neo4jPush: string | null;
  mcp: boolean;
  watch: boolean;
  wiki: boolean;
  obsidianDir: string | null;
  whisperModel: string;
  subcommand?: string;
  rest: string[];
}

export function parseFullArgs(args: readonly string[], cwd: string): FullParsedArgs {
  const result: FullParsedArgs = {
    path: cwd,
    mode: "normal",
    directed: false,
    update: false,
    clusterOnly: false,
    noViz: false,
    svg: false,
    graphml: false,
    neo4j: false,
    neo4jPush: null,
    mcp: false,
    watch: false,
    wiki: false,
    obsidianDir: null,
    whisperModel: "base",
    rest: [],
  };

  let i = 0;
  
  // Check for subcommands first
  if (args[0] === "query" || args[0] === "path" || args[0] === "add" || args[0] === "explain") {
    result.subcommand = args[0];
    result.rest = args.slice(1);
    return result;
  }

  // Check for path argument (first non-flag)
  if (args[0] && !args[0].startsWith("--")) {
    result.path = resolve(cwd, args[0]);
    i = 1;
  }

  // Parse flags
  while (i < args.length) {
    const arg = args[i];
    
    switch (arg) {
      case "--mode":
        if (i + 1 < args.length) {
          result.mode = args[i + 1] as "normal" | "deep";
          i++;
        }
        break;
      case "--directed":
        result.directed = true;
        break;
      case "--update":
        result.update = true;
        break;
      case "--cluster-only":
        result.clusterOnly = true;
        break;
      case "--no-viz":
        result.noViz = true;
        break;
      case "--svg":
        result.svg = true;
        break;
      case "--graphml":
        result.graphml = true;
        break;
      case "--neo4j":
        result.neo4j = true;
        break;
      case "--neo4j-push":
        if (i + 1 < args.length) {
          result.neo4jPush = args[i + 1];
          i++;
        }
        break;
      case "--mcp":
        result.mcp = true;
        break;
      case "--watch":
        result.watch = true;
        break;
      case "--wiki":
        result.wiki = true;
        break;
      case "--obsidian":
        // Next arg is the directory
        if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          i++; // skip to next which should be --obsidian-dir
        }
        break;
      case "--obsidian-dir":
        if (i + 1 < args.length) {
          result.obsidianDir = args[i + 1];
          i++;
        }
        break;
      case "--whisper-model":
        if (i + 1 < args.length) {
          result.whisperModel = args[i + 1];
          i++;
        }
        break;
      case "--html":
        // No-op, HTML is default
        break;
      default:
        if (!arg.startsWith("--")) {
          // Additional positional args
          result.rest.push(arg);
        }
    }
    i++;
  }

  return result;
}

export function getPythonDir(): string {
  return path.join(path.dirname(new URL(import.meta.url).pathname), "python");
}

export function getMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

export function shouldReextract(filePath: string, cacheMtime: number): boolean {
  return getMtime(filePath) > cacheMtime;
}
