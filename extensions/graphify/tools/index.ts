/**
 * Graphify Tools for PI Agent
 * 
 * Direct tool registration - agents can call these programmatically.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerBuildTool } from "./build-tool.js";
import { registerQueryTool } from "./query-tool.js";
import { registerContextTool } from "./context-tool.js";
import { registerExplainTool } from "./explain-tool.js";
import { registerPathTool } from "./path-tool.js";
import { registerIngestTool } from "./ingest-tool.js";
import { registerAnalyzeTool } from "./analyze-tool.js";

export function registerGraphifyTools(pi: ExtensionAPI) {
  registerBuildTool(pi);
  registerQueryTool(pi);
  registerContextTool(pi);
  registerExplainTool(pi);
  registerPathTool(pi);
  registerIngestTool(pi);
  registerAnalyzeTool(pi);
}
