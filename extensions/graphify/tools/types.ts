/**
 * Graphify Tool Types
 */

export interface BuildToolArgs {
  path?: string;
  mode?: "normal" | "deep";
  directed?: boolean;
  update?: boolean;
  exports?: string[];
}

export interface QueryToolArgs {
  question: string;
  mode?: "bfs" | "dfs";
  budget?: number;
  graphPath?: string;
}

export interface ContextToolArgs {
  filePath: string;
  depth?: number;
  graphPath?: string;
}

export interface ExplainToolArgs {
  concept: string;
  graphPath?: string;
}

export interface PathToolArgs {
  from: string;
  to: string;
  graphPath?: string;
}

export interface IngestToolArgs {
  url: string;
  author?: string;
  contributor?: string;
  targetPath?: string;
}

export interface AnalyzeToolArgs {
  type: "gaps" | "surprises" | "god_nodes" | "communities" | "bridges";
  limit?: number;
  graphPath?: string;
}
