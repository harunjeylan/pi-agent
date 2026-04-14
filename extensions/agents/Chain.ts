import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Input, Key, matchesKey, Text } from "@mariozechner/pi-tui";
import { existsSync } from "fs";
import { join } from "path";
import { Agent, ChainStep } from "./Agent";

interface ChainItem {
  name: string;
  selected: boolean;
}

interface ChainResult {
  steps: ChainStep[];
}

interface ChainStepState {
  agent: string;
  status: "pending" | "running" | "done" | "error";
  elapsed: number;
  output: string;
  lastWork: string;
  toolCount: number;
  contextPct: number;
}

export class ChainManager {
  private pi: ExtensionAPI;
  private agent: Agent;
  private gridCols = 2;
  private widgetCtx: any;
  private stepStates: ChainStepState[] = [];
  private readonly MAX_LAST_WORK_LENGTH = 100;

  constructor(pi: ExtensionAPI, agent: Agent) {
    this.pi = pi;
    this.agent = agent;
    this.registerCommands();
    this.registerTools();
    this.registerChainTools();
    this.registerListeners();
  }

  private updateWidget(): void {
    if (!this.widgetCtx) return;
    this.syncStepStates();
    this.agent.registerChainWidget(this.widgetCtx);
  }

  private syncStepStates(): void {
    for (let i = 0; i < this.stepStates.length; i++) {
      this.agent.updateChainStepState(i, {
        status: this.stepStates[i].status,
        elapsed: this.stepStates[i].elapsed,
        lastWork: this.stepStates[i].lastWork,
        toolCount: this.stepStates[i].toolCount,
        contextPct: this.stepStates[i].contextPct,
      });
    }
  }

  private dispatchChainAgent(
    agentName: string,
    task: string,
    stepIndex: number,
    ctx: any,
  ): Promise<{
    output: string;
    exitCode: number;
    elapsed: number;
    toolCount: number;
    contextPct: number;
  }> {
    const profile = this.agent.getProfile(agentName);
    if (!profile) {
      return Promise.resolve({
        output: `Profile "${agentName}" not found`,
        exitCode: 1,
        elapsed: 0,
        toolCount: 0,
        contextPct: 0,
      });
    }

    const stepState = this.stepStates[stepIndex];
    if (!stepState) {
      return Promise.resolve({
        output: `Step ${stepIndex} not found`,
        exitCode: 1,
        elapsed: 0,
        toolCount: 0,
        contextPct: 0,
      });
    }

    stepState.status = "running";
    stepState.elapsed = 0;
    stepState.lastWork = "";
    stepState.toolCount = 0;
    stepState.contextPct = 0;
    this.updateWidget();

    const model = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "openrouter/google/gemini-3-flash-preview";

    const tools = profile.tools?.join(",") || "read,bash,grep,find,ls,edit";
    const sessionFile = join(this.agent.getSessionDir(), `chain-${agentName.toLowerCase()}.json`);
    const hasSession = existsSync(sessionFile);

    const args = [
      "--mode", "json",
      "-p",
      "--no-extensions",
      "--model", model,
      "--tools", tools,
      "--thinking", "off",
      "--append-system-prompt", profile.body,
      "--session", sessionFile,
    ];

    if (hasSession) {
      args.push("-c");
    }

    args.push(task);

    const startTime = Date.now();
    const textChunks: string[] = [];
    let toolCount = 0;
    let contextPct = 0;

    const timer = setInterval(() => {
      const state = this.stepStates[stepIndex];
      if (state) {
        state.elapsed = Date.now() - startTime;
        this.updateWidget();
      }
    }, 1000);

    return new Promise((resolve) => {
      const proc = spawn("pi", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let buffer = "";

      proc.stdout!.setEncoding("utf-8");
      proc.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === "message_update") {
              const delta = event.assistantMessageEvent;
              if (delta?.type === "text_delta") {
                textChunks.push(delta.delta || "");
                const full = textChunks.join("");
                const last = full.split("\n").filter((l: string) => l.trim()).pop() || "";
                const state = this.stepStates[stepIndex];
                if (state) {
                  state.lastWork = last.slice(0, this.MAX_LAST_WORK_LENGTH);
                }
              }
            } else if (event.type === "tool_execution_start") {
              const state = this.stepStates[stepIndex];
              if (state) {
                state.toolCount++;
                this.updateWidget();
              }
            } else if (event.type === "message_end") {
              const msg = event.message;
              if (msg?.usage) {
                const inputTokens = msg.usage.input || 0;
                const maxContext = 128000;
                contextPct = Math.round((inputTokens / maxContext) * 100);
                const state = this.stepStates[stepIndex];
                if (state) {
                  state.contextPct = contextPct;
                }
              }
            }
          } catch {}
        }
        this.updateWidget();
      });

      proc.stderr!.setEncoding("utf-8");
      proc.stderr!.on("data", () => {});

      proc.on("close", (code) => {
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            if (event.type === "message_update") {
              const delta = event.assistantMessageEvent;
              if (delta?.type === "text_delta") {
                textChunks.push(delta.delta || "");
              }
            }
          } catch {}
        }

        clearInterval(timer);
        const elapsed = Date.now() - startTime;
        const exitCode = code ?? 1;

        const full = textChunks.join("");
        const lastWork = full.split("\n").filter((l: string) => l.trim()).pop() || "";

        const state = this.stepStates[stepIndex];
        if (state) {
          state.status = exitCode === 0 ? "done" : "error";
          state.output = full;
          state.elapsed = elapsed;
          state.lastWork = lastWork.slice(0, this.MAX_LAST_WORK_LENGTH);
          state.toolCount = toolCount;
          state.contextPct = contextPct;
        }

        this.updateWidget();

        resolve({
          output: full,
          exitCode,
          elapsed,
          toolCount,
          contextPct,
        });
      });

      proc.on("error", (err) => {
        clearInterval(timer);
        const state = this.stepStates[stepIndex];
        if (state) {
          state.status = "error";
          state.output = `Error: ${err.message}`;
          state.elapsed = Date.now() - startTime;
        }
        this.updateWidget();

        resolve({
          output: `Error: ${err.message}`,
          exitCode: 1,
          elapsed: Date.now() - startTime,
          toolCount: 0,
          contextPct: 0,
        });
      });
    });
  }

  private renderCard(state: ChainStepState, colWidth: number, theme: any): string[] {
    const w = colWidth - 2;
    const truncate = (s: string, max: number) =>
      s.length > max ? s.slice(0, max - 3) + "..." : s;

    const statusColor =
      state.status === "pending" ? "dim" :
      state.status === "running" ? "accent" :
      state.status === "done" ? "success" : "error";
    const statusIcon =
      state.status === "pending" ? "○" :
      state.status === "running" ? "●" :
      state.status === "done" ? "✓" : "✗";

    const nameStr = truncate(state.agent, w);
    const nameVisible = nameStr.length;

    const statusStr = `${statusIcon} ${state.status}`;
    const timeStr = state.status !== "pending" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
    const statusLine = theme.fg(statusColor, statusStr + timeStr);
    const statusVisible = statusStr.length + timeStr.length;

    const toolStr = state.toolCount > 0 ? `${state.toolCount}` : "";
    const ctxStr = state.contextPct > 0 ? `${Math.round(state.contextPct)}%` : "";
    const statsParts: string[] = [];
    if (toolStr) statsParts.push(`🛠${toolStr}`);
    if (ctxStr) statsParts.push(`📊${ctxStr}`);
    const statsContent = statsParts.join(" ");
    const statsLine = theme.fg("muted", statsContent);
    const statsVisible = statsContent.length;

    const workRaw = state.lastWork || "";
    const workText = truncate(workRaw, Math.min(50, w - 1));
    const workLine = theme.fg("muted", workText || "—");
    const workVisible = (workText || "—").length;

    const top = "┌" + "─".repeat(w) + "┐";
    const bot = "└" + "─".repeat(w) + "┘";
    const border = (content: string, visLen: number) =>
      theme.fg("dim", "│") +
      content +
      " ".repeat(Math.max(0, w - visLen)) +
      theme.fg("dim", "│");

    return [
      theme.fg("dim", top),
      border(" " + theme.fg("accent", truncate(state.agent, w)), 1 + nameVisible),
      border(" " + statusLine, 1 + statusVisible),
      border(" " + statsLine, 1 + statsVisible),
      border(" " + workLine, 1 + workVisible),
      theme.fg("dim", bot),
    ];
  }

  private registerListeners(): void {
    this.pi.on("session_start", async (_event, ctx) => {
      this.widgetCtx = ctx;

      if (this.agent.getMode() === "chain") {
        this.agent.registerChainWidget(ctx);
        const steps = this.agent.getChainSteps();
        ctx.ui.setStatus("agent-chain", `Chain (${steps.length} steps)`);
      }
    });

    this.pi.on("before_agent_start", async (_event, _ctx) => {
      if (this.agent.getMode() !== "chain") {
        return {};
      }

      const profiles = this.agent.getProfiles();
      const steps = this.agent.getChainSteps();

      const agentCatalog = steps
        .map((s) => {
          const profile = profiles.find((p) => p.name === s.agent);
          return `### ${s.agent}\n**Description:** ${profile?.description || "No description"}\n**Tools:** ${profile?.tools?.join(", ") || "read,grep,find,ls,edit"}`;
        })
        .join("\n\n");

      const flow = steps.map((s) => s.agent).join(" → ");

      return {
        systemPrompt: `You are orchestrating a sequential agent pipeline called a "Chain".
Each step runs in order — output from one step feeds into the next.

## Active Chain: ${flow}

## Chain Steps

${agentCatalog}

## Available Tools
- create_chain: Create a new chain of agents
- run_chain: Execute the chain pipeline
- clear_chain: Clear the chain and return to single mode

## Placeholders
- $INPUT: Replaced with output from previous step
- $ORIGINAL: Replaced with the original user task

## How to Use
- Use run_chain to execute the chain pipeline
- Each step receives the previous step's output as $INPUT
- Steps run sequentially, waiting for each to complete before next

## Guidelines
- Use run_chain for multi-step workflows
- Review results after chain completes
- Use create_chain to programmatically create chains
- Use clear_chain when chain is no longer needed`,
      };
    });
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
            ctx.ui.setWidget("agent-chain", undefined);
            ctx.ui.setStatus("agent-chain", undefined);
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
            promptInput.setValue("$INPUT");

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
                promptInput.setValue("$INPUT");
              } else if (data === "enter" || matchesKey(data, Key.enter)) {
                const step = currentChain.find(s => s.agent === promptTarget);
                if (step) {
                  step.prompt = promptInput.getValue() || "$INPUT";
                } else {
                  currentChain.push({ agent: promptTarget, prompt: promptInput.getValue() || "$INPUT" });
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
                promptInput.setValue(existingStep?.prompt || "$INPUT");
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
                done(void 0 as unknown as ChainResult);
              } else {
                done({ steps });
              }
            }
            if (data === "escape" || matchesKey(data, Key.escape)) {
              done(void 0 as unknown as ChainResult);
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
      name: "chain_execute",
      label: "Execute Chain",
      description:
        "Execute the chain pipeline.\n\n" +
        "- Sequential: each step runs one after another\n" +
        "- Output feeds into next: use $INPUT in prompts to get previous output\n" +
        "- Use $ORIGINAL to access the initial task\n\n" +
        "Prerequisites: Use chain_build first to create the pipeline.",
      parameters: Type.Object({
        task: Type.String({ description: "Initial task for the first agent" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const steps = this.agent.getChainSteps();
        if (steps.length === 0) {
          return { content: [{ type: "text", text: "No chain configured. Use /chain to build one." }], details: undefined };
        }

        this.widgetCtx = ctx;

        this.stepStates = steps.map((s) => ({
          agent: s.agent,
          status: "pending" as const,
          elapsed: 0,
          output: "",
          lastWork: "",
          toolCount: 0,
          contextPct: 0,
        }));
        this.syncStepStates();
        this.updateWidget();

        const originalTask = params.task;
        let previousOutput = params.task;
        const results: string[] = [];

        for (let i = 0; i < steps.length; i++) {
          const stepIndex = i;
          const step = steps[i];
          const task = step.prompt
            .replace(/\$INPUT/g, previousOutput)
            .replace(/\$ORIGINAL/g, originalTask);

          const result = await this.dispatchChainAgent(step.agent, task, stepIndex, ctx);

          if (result.exitCode !== 0) {
            const retry = await this.dispatchChainAgent(step.agent, task, stepIndex, ctx);
            if (retry.exitCode !== 0) {
              this.stepStates[stepIndex].status = "error";
              this.updateWidget();
              return {
                content: [{ type: "text", text: `Error at step ${stepIndex + 1} (${step.agent}): ${retry.output}` }],
                details: { status: "error", step: stepIndex + 1, agent: step.agent }
              };
            }
            this.stepStates[stepIndex].status = "done";
            this.stepStates[stepIndex].lastWork = retry.output.split("\n").pop() || "";
            this.stepStates[stepIndex].toolCount = retry.toolCount || 0;
            this.stepStates[stepIndex].contextPct = retry.contextPct || 0;
            this.updateWidget();
            previousOutput = retry.output;
          } else {
            this.stepStates[stepIndex].status = "done";
            this.stepStates[stepIndex].lastWork = result.output.split("\n").pop() || "";
            this.stepStates[stepIndex].toolCount = result.toolCount || 0;
            this.stepStates[stepIndex].contextPct = result.contextPct || 0;
            this.updateWidget();
            previousOutput = result.output;
          }

          results.push(`[${step.agent}] ${result.output.slice(0, 200)}...`);
        }

        return {
          content: [{ type: "text", text: `Chain complete:\n${results.join("\n")}\n\nFinal output:\n${previousOutput}` }],
          details: { status: "done", steps: steps.length, output: previousOutput }
        };
      },

      renderCall(args, theme) {
        const task = (args as any).task || "";
        const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
        return new Text(
          theme.fg("toolTitle", theme.bold("chain_execute ")) +
            theme.fg("dim", "— ") +
            theme.fg("muted", preview),
          0, 0,
        );
      },

      renderResult(result, options, theme) {
        const details = result.details as any;
        if (details?.status === "done") {
          const summary = theme.fg("success", "✓ ") + theme.fg("accent", "Chain") +
            theme.fg("dim", ` (${details.steps} steps)`);
          if (options.expanded && details.output) {
            return new Text(summary + "\n" + details.output, 0, 0);
          }
          return new Text(summary, 0, 0);
        }
        if (details?.status === "error") {
          return new Text(
            theme.fg("error", "✗ ") + theme.fg("accent", `Step ${details.step} (${details.agent})`),
            0, 0,
          );
        }
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text.slice(0, 100) : "", 0, 0);
      },
    });
  }

  private registerChainTools(): void {
    this.pi.registerTool({
      name: "chain_build",
      label: "Build Chain",
      description:
        "Build a sequential pipeline of agents.\n\n" +
        "Usage:\n" +
        "1. Call with list of agent names in order (first to last)\n" +
        "2. Editor opens to set prompt for each step\n" +
        "3. Use $INPUT to get output from previous step\n" +
        "4. Use chain_execute to run the pipeline\n\n" +
        "Example: chain_build [\"Researcher\", \"Summarizer\", \"Reviewer\"]",
      parameters: Type.Object({
        agents: Type.Array(Type.String(), {
          description: "Agent names in order (first to last)",
        }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const profiles = this.agent.getProfiles();
        const validProfiles = profiles.filter((p) => p && typeof p.name === "string");

        const agentNames = params.agents as string[];

        const valid: string[] = [];
        for (const name of agentNames) {
          const normalized = name.toLowerCase().replace(/\s+/g, "-");
          const profile = validProfiles.find(
            (p) =>
              p.name.toLowerCase() === name.toLowerCase() ||
              p.name.toLowerCase().replace(/\s+/g, "-") === normalized,
          );
          if (profile) {
            valid.push(profile.name);
          }
        }

        if (valid.length === 0) {
          return {
            content: [
              { type: "text", text: "No valid agents specified. Use agent_list to see available agents." },
            ],
            details: undefined,
          };
        }

        const steps: ChainStep[] = valid.map((name) => ({
          agent: name,
          prompt: "$INPUT",
        }));

        this.agent.setChainSteps(steps);
        this.agent.setMode("chain");
        this.agent.registerChainWidget(ctx);
        ctx.ui.setStatus("agent-chain", `Chain (${steps.length} steps)`);

        const flow = valid.join(" → ");
        return {
          content: [
            {
              type: "text",
              text: `Chain created with ${steps.length} steps: ${flow}\nUse chain_execute to run the pipeline.`,
            },
          ],
          details: undefined,
        };
      },
    });

    this.pi.registerTool({
      name: "chain_clear",
      label: "Clear Chain",
      description: "Clear the current chain and return to single agent mode.",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
        const steps = this.agent.getChainSteps();

        if (steps.length === 0) {
          return {
            content: [{ type: "text", text: "No chain to clear. Already in single mode." }],
            details: undefined,
          };
        }

        const count = steps.length;
        this.agent.setChainSteps([]);
        this.agent.setMode("single");
        ctx.ui.setWidget("agent-chain", undefined);
        ctx.ui.setStatus("agent-chain", undefined);

        return {
          content: [
            { type: "text", text: `Chain cleared. ${count} steps removed. Returned to single agent mode.` },
          ],
          details: undefined,
        };
      },
    });
  }
}