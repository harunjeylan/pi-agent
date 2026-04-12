/**
 * Tools Extension
 *
 * Provides a /tools command to enable/disable tools interactively.
 * Tool selection persists across session reloads and respects branch navigation.
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Use /tools to open the tool selector
 */

import * as fs from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolInfo,
} from "@mariozechner/pi-coding-agent";
import {
  getSettingsListTheme,
  parseFrontmatter,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
} from "@mariozechner/pi-tui";
export type AgentScope = "user" | "project" | "both";
export type AgentMode = "all" | "subagent" | "primary";

// State persisted to session
interface ToolsState {
  enabledTools: string[];
}

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  mode?: AgentMode;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

function scanAgents(dir: string, source: string): AgentConfig[] {
  if (!existsSync(dir)) return [];
  const agents: AgentConfig[] = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const raw = readFileSync(join(dir, file), "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      agents.push({
        name: frontmatter.name || basename(file, ".md"),
        description: frontmatter.description || "",
        mode: (frontmatter.mode as AgentMode) || "subagent",
        tools: frontmatter.tools
          ? frontmatter.tools.split(",").map((t) => t.trim())
          : [],
        body: body.trim(),
        source,
      });
    }
  } catch {}
  return agents.filter((a) => a.mode === "all" || a.mode === "primary");
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string): AgentDiscoveryResult {
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const home = homedir();
  const dirs: [string, string][] = [
    [join(home, ".pi", "agent", "agents"), "~/.pi"],
    [join(cwd, ".pi", "agents"), ".pi"],
  ];
  const agentMap = new Map<string, AgentConfig>();
  for (const [dir, source] of dirs) {
    const agents = scanAgents(dir, source);
    for (const agent of agents) {
      const key = agent.name.toLowerCase();
      if (agentMap.has(key)) continue;
      agentMap.set(key, agent);
    }
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export default function toolsExtension(pi: ExtensionAPI) {
  // Track enabled tools
  let enabledTools: Set<string> = new Set();
  let allTools: ToolInfo[] = [];

  // Persist current state
  function persistState() {
    pi.appendEntry<ToolsState>("tools-config", {
      enabledTools: Array.from(enabledTools),
    });
  }

  // Apply current tool selection
  function applyTools() {
    pi.setActiveTools(Array.from(enabledTools));
  }

  // Find the last tools-config entry in the current branch
  function restoreFromBranch(ctx: ExtensionContext) {
    allTools = pi.getAllTools();

    // Get entries in current branch only
    const branchEntries = ctx.sessionManager.getBranch();
    let savedTools: string[] | undefined;

    for (const entry of branchEntries) {
      if (entry.type === "custom" && entry.customType === "tools-config") {
        const data = entry.data as ToolsState | undefined;
        if (data?.enabledTools) {
          savedTools = data.enabledTools;
        }
      }
    }

    if (savedTools) {
      // Restore saved tool selection (filter to only tools that still exist)
      const allToolNames = allTools.map((t) => t.name);
      enabledTools = new Set(
        savedTools.filter((t: string) => allToolNames.includes(t)),
      );
      applyTools();
    } else {
      // No saved state - sync with currently active tools
      enabledTools = new Set(pi.getActiveTools());
    }
  }

  // Register /tools command
  pi.registerCommand("tools", {
    description: "Enable/disable tools",
    handler: async (_args, ctx) => {
      // Refresh tool list
      allTools = pi.getAllTools();

      await ctx.ui.custom((tui, theme, _kb, done) => {
        // Build settings items for each tool
        const items: SettingItem[] = allTools.map((tool) => ({
          id: tool.name,
          label: tool.name,
          currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
          values: ["enabled", "disabled"],
        }));

        const container = new Container();
        container.addChild(
          new (class {
            render(_width: number) {
              return [theme.fg("accent", theme.bold("Tool Configuration")), ""];
            }
            invalidate() {}
          })(),
        );

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          (id, newValue) => {
            // Update enabled state and apply immediately
            if (newValue === "enabled") {
              enabledTools.add(id);
            } else {
              enabledTools.delete(id);
            }
            applyTools();
            persistState();
          },
          () => {
            // Close dialog
            done(undefined);
          },
        );

        container.addChild(settingsList);

        const component = {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };

        return component;
      });
    },
  });

  // Restore state on session start
  pi.on("session_start", async (_event, ctx) => {
    restoreFromBranch(ctx);
  });

  // Restore state when navigating the session tree
  pi.on("session_tree", async (_event, ctx) => {
    restoreFromBranch(ctx);
  });
}
