import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Input, Key, matchesKey } from "@mariozechner/pi-tui";
import { Agent, ChainStep } from "./Agent";

interface ChainItem {
  name: string;
  selected: boolean;
}

interface ChainResult {
  steps: ChainStep[];
}

export class ChainManager {
  private pi: ExtensionAPI;
  private agent: Agent;
  private gridCols = 2;

  constructor(pi: ExtensionAPI, agent: Agent) {
    this.pi = pi;
    this.agent = agent;
    this.registerCommands();
    this.registerTools();
  }

  private registerCommands(): void {
    this.pi.registerCommand("chain-grid", {
      description: "Set grid columns: /chain-grid <1-6>",
      handler: async (args, ctx) => {
        const n = parseInt(args?.trim() || "", 10);
        if (n >= 1 && n <= 6) {
          this.gridCols = n;
          this.agent.registerChainWidget(ctx);
          ctx.ui.notify(`Grid set to ${n} columns`, "info");
        } else {
          ctx.ui.notify("Usage: /chain-grid <1-6>", "warning");
        }
      },
    });

    this.pi.registerCommand("chain", {
      description: "Build chain: /chain",
      handler: async (args, ctx) => {
        const profiles = this.agent.getProfiles();
        if (!Array.isArray(profiles) || profiles.length === 0) {
          ctx.ui.notify("No profiles found in .pi/agents/", "warning");
          return;
        }

        const validProfiles = profiles.filter(p => p && typeof p.name === "string");

        if (args?.trim()) {
          const sub = args.trim().toLowerCase();
          if (sub === "list") {
            const steps = this.agent.getChainSteps();
            if (steps.length === 0) {
              ctx.ui.notify("No chain. Use /chain to build one.", "info");
              return;
            }
            const chainStr = steps.map(s => s.agent).join(" -> ");
            ctx.ui.notify(`Chain: ${chainStr}`, "info");
            return;
          }
          if (sub === "clear") {
            this.agent.setChainSteps([]);
            this.agent.setMode("single");
            ctx.ui.notify("Chain cleared.", "info");
            return;
          }
          if (sub.startsWith("add ")) {
            const name = sub.slice(4).trim();
            const profile = validProfiles.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (!profile) {
              ctx.ui.notify(`Profile "${name}" not found.`, "warning");
              return;
            }
            const steps = this.agent.getChainSteps();
            steps.push({ agent: profile.name, prompt: "$INPUT" });
            this.agent.setChainSteps(steps);
            this.agent.setMode("chain");
            ctx.ui.notify(`Added ${profile.name} to chain.`, "info");
            return;
          }
          if (sub.startsWith("remove ")) {
            const idx = parseInt(sub.slice(7).trim()) - 1;
            const steps = this.agent.getChainSteps();
            if (isNaN(idx) || idx < 0 || idx >= steps.length) {
              ctx.ui.notify(`Invalid index. Use /chain list to see steps.`, "warning");
              return;
            }
            const removed = steps.splice(idx, 1)[0];
            this.agent.setChainSteps(steps);
            if (steps.length === 0) {
              this.agent.setMode("single");
            }
            ctx.ui.notify(`Removed ${removed.agent} from chain.`, "info");
            return;
          }
        }

        const currentChain = this.agent.getChainSteps();
        const items: ChainItem[] = validProfiles.map(p => ({
          name: p.name,
          selected: currentChain.some(s => s.agent === p.name),
        }));

        let cachedLines: string[] | undefined;

        const result = await ctx.ui.custom<ChainResult>((tui, theme, _kb, done) => {
          let cursor = 0;
          let promptMode = false;
          let promptTarget = "";
          const promptInput = new Input();
          promptInput.value = "$INPUT";

          const buildSteps = (): ChainStep[] => {
            const steps: ChainStep[] = [];
            for (const item of items) {
              if (item.selected) {
                const existingStep = currentChain.find(s => s.agent === item.name);
                steps.push({ 
                  agent: item.name, 
                  prompt: existingStep?.prompt || "$INPUT" 
                });
              }
            }
            return steps;
          };

          const refresh = () => {
            cachedLines = undefined;
            tui.requestRender();
          };

          const render = (width: number): string[] => {
            if (cachedLines) return cachedLines;

            const steps = buildSteps();
            const lines: string[] = [];
            lines.push(theme.fg("dim", "─".repeat(width)));
            lines.push(theme.fg("accent", " Interactive Chain Builder "));
            lines.push("");

            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const check = item.selected ? "[x]" : "[ ]";
              const prefix = i === cursor ? theme.fg("accent", ">") : " ";
              const checkColor = item.selected ? "success" : "dim";
              const name = i === cursor ? theme.fg("text", item.name) : item.name;
              lines.push(`${prefix} ${theme.fg(checkColor, check)}: ${name}`);
            }

            lines.push("");
            lines.push(theme.fg("dim", "─".repeat(width)));
            lines.push(theme.fg("dim", "Current Chain:"));
            if (steps.length === 0) {
              lines.push(theme.fg("dim", " (empty)"));
            } else {
              const chainDisplay = steps.map((s, i) => {
                return i === 0 ? theme.fg("accent", s.agent) : theme.fg("dim", "->") + theme.fg("accent", s.agent);
              }).join(" ");
              lines.push(chainDisplay);
            }
            lines.push("");
            lines.push(theme.fg("dim", "[Space] Toggle  [P] Set Prompt  [A] Select All  [C] Clear All  [Enter] Confirm  [Esc] Cancel"));
            lines.push(theme.fg("dim", "─".repeat(width)));

            if (promptMode) {
              lines.push("");
              const name = promptTarget;
              lines.push(
                theme.fg(
                  "accent",
                  `──[${name}]${"─".repeat(Math.max(0, width - name.length - 5))}`,
                ),
              );
              for (const line of promptInput.render(
                Math.min(36, width - 2),
              )) {
                lines.push(theme.fg("accent", " ") + line);
              }
              lines.push("");
              lines.push(theme.fg("accent", "─".repeat(width)));
              lines.push(theme.fg("accent", "[Enter] Confirm  [Esc] Cancel"));
            }
            lines.push("");
            cachedLines = lines;
            return lines;
          };

          const handleInput = (data: string) => {
            if (promptMode) {
              if (data === "escape" || matchesKey(data, Key.escape)) {
                promptMode = false;
                promptInput.value = "$INPUT";
              } else if (data === "enter" || matchesKey(data, Key.enter)) {
                const step = currentChain.find(s => s.agent === promptTarget);
                if (step) {
                  step.prompt = promptInput.value || "$INPUT";
                } else {
                  currentChain.push({ agent: promptTarget, prompt: promptInput.value || "$INPUT" });
                }
                promptMode = false;
              } else {
                promptInput.handleInput(data);
              }
              refresh();
              return;
            }

            if (data === "up" || matchesKey(data, Key.up)) cursor = Math.max(0, cursor - 1);
            if (data === "down" || matchesKey(data, Key.down)) cursor = Math.min(items.length - 1, cursor + 1);
            if (data === " " || matchesKey(data, Key.space)) {
              items[cursor].selected = !items[cursor].selected;
            }
            if (data === "p" || data === "P") {
              if (items[cursor].selected) {
                promptMode = true;
                promptTarget = items[cursor].name;
                const existingStep = currentChain.find(s => s.agent === items[cursor].name);
                promptInput.value = existingStep?.prompt || "$INPUT";
                promptInput.cursor = promptInput.value.length;
              }
            }
            if (data === "a" || data === "A") {
              for (const item of items) item.selected = true;
            }
            if (data === "c" || data === "C") {
              for (const item of items) item.selected = false;
            }
            if (data === "enter" || matchesKey(data, Key.enter)) {
              const steps = buildSteps();
              if (steps.length === 0) {
                done(null);
              } else {
                done({ steps });
              }
            }
            if (data === "escape" || matchesKey(data, Key.escape)) {
              done(null);
            }
            refresh();
          };

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        });

        if (result?.steps && result.steps.length > 0) {
          this.agent.setChainSteps(result.steps);
          this.agent.setMode("chain");
          this.agent.registerChainWidget(ctx);
          const chainStr = result.steps.map(s => s.agent).join(" -> ");
          ctx.ui.notify(`Chain: ${chainStr}`, "info");
        }
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "run_chain",
      description: "Execute the chain pipeline",
      parameters: Type.Object({
        task: Type.String({ description: "Initial task for the first agent" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const steps = this.agent.getChainSteps();
        if (steps.length === 0) {
          return { content: [{ type: "text", text: "No chain configured. Use /chain to build one." }] };
        }

        let previousOutput = params.task;
        const results: string[] = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const task = step.prompt.replace(/\$INPUT/g, previousOutput);

          const result = await this.agent.spawnAgent({
            agentName: step.agent,
            task: task,
          });

          if (result.exitCode !== 0) {
            const retry = await this.agent.spawnAgent({
              agentName: step.agent,
              task: task,
            });
            if (retry.exitCode !== 0) {
              return { content: [{ type: "text", text: `Error at step ${i + 1} (${step.agent}): ${retry.output}` }] };
            }
            previousOutput = retry.output;
          } else {
            previousOutput = result.output;
          }

          results.push(`[${step.agent}] ${result.output.slice(0, 200)}...`);
        }

        return { content: [{ type: "text", text: `Chain complete:\n${results.join("\n")}\n\nFinal output:\n${previousOutput}` }] };
      },
    });
  }
}