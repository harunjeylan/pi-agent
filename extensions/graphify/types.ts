import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface GraphifyState {
  lastGraphPath?: string;
  pythonExecutable?: string;
  lastBuildTime?: number;
}

export interface DetectResult {
  total_files: number;
  total_words: number;
  files: {
    code?: string[];
    document?: string[];
    paper?: string[];
    image?: string[];
    video?: string[];
  };
  skipped_sensitive?: string[];
  warning?: string | null;
  needs_graph?: boolean;
}

export interface GraphResult {
  nodes: number;
  edges: number;
  communities: number;
  outputDir: string;
}

export interface ParsedArgs {
  path: string;
  mode: "normal" | "deep";
  directed: boolean;
  subcommand?: string;
  rest: string[];
}

export interface QueryOptions {
  mode?: "bfs" | "dfs";
  budget?: number;
}

export interface BuildOptions {
  mode?: "normal" | "deep";
  directed?: boolean;
  update?: boolean;
}

export interface ExportOptions {
  svg?: boolean;
  graphml?: boolean;
  neo4j?: boolean;
  neo4jPush?: string | null;
  wiki?: boolean;
  obsidianDir?: string | null;
  noViz?: boolean;
}

export interface IngestOptions {
  author?: string;
  contributor?: string;
}

export type StateManager = {
  state: GraphifyState;
  persist: (ctx: ExtensionContext) => void;
  restore: (ctx: ExtensionContext) => void;
};
