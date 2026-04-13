import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Input, Key, matchesKey, Text } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { Agent } from "./Agent";

interface TeamItem {
  name: string;
  selected: boolean;
  prompt: string;
}

interface TeamResult {
  members: TeamItem[];
}

interface TeamDispatchState {
  agentName: string;
  task: string;
  status: "dispatching" | "running" | "done" | "error";
  elapsed: number;
  exitCode: number;
  fullOutput: string;
}

export class TeamManager {
  private pi: ExtensionAPI;
  private agent: Agent;
  private gridCols = 2;
  private widgetCtx: any;
  private contextWindow = 0;

  constructor(pi: ExtensionAPI, agent: Agent) {
    this.pi = pi;
    this.agent = agent;
    this.dispatchAgent = this.dispatchAgent.bind(this);
    this.registerCommands();
    this.registerTools();
    this.registerTeamTools();
    this.registerListeners();
  }

  private registerListeners(): void {
    this.pi.on("session_start", async (_event, ctx) => {
      this.widgetCtx = ctx;
      this.contextWindow = ctx.model?.contextWindow || 0;

      const sessDir = join(ctx.cwd, ".pi", "agent-sessions");
      if (existsSync(sessDir)) {
        for (const f of readdirSync(sessDir)) {
          if (f.endsWith(".json")) {
            try {
              unlinkSync(join(sessDir, f));
            } catch {}
          }
        }
      }

      if (this.agent.getMode() === "team") {
        const members = this.agent.getTeamMembers();
        this.agent.registerTeamWidget(ctx);
        ctx.ui.setStatus("agent-team", `Team (${members.length})`);
      }
    });

    this.pi.on("before_agent_start", async (_event, _ctx) => {
      if (this.agent.getMode() !== "team") {
        return {};
      }

      const profiles = this.agent.getProfiles();
      const members = this.agent.getTeamMembers();

      const agentCatalog = profiles
        .filter((p) => members.includes(p.name))
        .map(
          (p) =>
            `### ${p.name}\n**Description:** ${
              p.description || "No description"
            }\n**Tools:** ${p.tools?.join(", ") || "read,grep,find,ls,edit"}`,
        )
        .join("\n\n");

      const memberList = members.join(", ");

      return {
        systemPrompt: `You are a SUPERVISOR agent. Your role is to coordinate specialist agents to accomplish complex tasks.
You do NOT have direct access to the codebase. You MUST delegate all work.

## Your Role: SUPERVISOR
- Analyze the user's request
- Break it into sub-tasks
- Select the appropriate specialist for each sub-task
- Dispatch tasks and review results
- Synthesize findings for the user

## Team Members
${memberList}

## Available Specialists

${agentCatalog}

## How to Dispatch Tasks
Use the dispatch_agent tool with:
- agent: The specialist name
- task: Clear, focused task description

## Rules
- NEVER read, write, or execute code directly — you have no such tools
- ALWAYS use dispatch_agent to get work done
- Keep tasks focused — one clear objective per dispatch
- If a specialist fails, retry once, then try a different specialist
- Summarize results clearly for the user`,
      };
    });
  }

  private updateWidget(): void {
    if (!this.widgetCtx) return;
    this.agent.registerTeamWidget(this.widgetCtx);
  }

  private dispatchAgent(
    agentName: string,
    task: string,
    ctx: any,
  ): Promise<{ output: string; exitCode: number; elapsed: number }> {
    const member = this.agent
      .getTeamMembers()
      .find((m) => m.toLowerCase() === agentName.toLowerCase());
    if (!member) {
      return Promise.resolve({
        output: `Agent "${agentName}" not found. Available: ${this.agent.getTeamMembers().join(", ")}`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    const teamState = this.agent.getTeamState(member);
    if (!teamState) {
      return Promise.resolve({
        output: `No state found for team member "${member}"`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    if (teamState.status === "running") {
      return Promise.resolve({
        output: `Agent "${member}" is already running. Wait for it to finish.`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    this.agent.updateTeamState(member, {
      status: "running",
      task: task,
      toolCount: 0,
      elapsed: 0,
      lastWork: "",
    });

    this.updateWidget();

    const prompt = teamState.prompt.replace(/\$INPUT/g, task);
    const profile = this.agent.getProfile(member);

    if (!profile) {
      return Promise.resolve({
        output: `Profile not found for "${member}"`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    const model = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "openrouter/google/gemini-3-flash-preview";

    const tools = profile.tools?.join(",") || "read,bash,grep,find,ls,edit";
    const sessionFile = teamState.sessionFile;
    const hasSession = existsSync(sessionFile);

    const args = [
      "--mode",
      "json",
      "-p",
      "--no-extensions",
      "--model",
      model,
      "--tools",
      tools,
      "--thinking",
      "off",
      "--append-system-prompt",
      profile.body,
      "--session",
      sessionFile,
    ];

    if (hasSession) {
      args.push("-c");
    }

    args.push(prompt);

    const startTime = Date.now();
    const textChunks: string[] = [];

    const timer = setInterval(() => {
      const state = this.agent.getTeamState(member);
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
                const last =
                  full
                    .split("\n")
                    .filter((l: string) => l.trim())
                    .pop() || "";
                this.agent.updateTeamState(member, { lastWork: last });
                this.updateWidget();
              }
            } else if (event.type === "tool_execution_start") {
              const state = this.agent.getTeamState(member);
              if (state) {
                this.agent.updateTeamState(member, {
                  toolCount: state.toolCount + 1,
                });
                this.updateWidget();
              }
            } else if (event.type === "message_end") {
              const msg = event.message;
              if (msg?.usage && this.contextWindow > 0) {
                const pct = ((msg.usage.input || 0) / this.contextWindow) * 100;
                this.agent.updateTeamState(member, { contextPct: pct });
                this.updateWidget();
              }
            } else if (event.type === "agent_end") {
              const msgs = event.messages || [];
              const last = [...msgs]
                .reverse()
                .find((m: any) => m.role === "assistant");
              if (last?.usage && this.contextWindow > 0) {
                const pct =
                  ((last.usage.input || 0) / this.contextWindow) * 100;
                this.agent.updateTeamState(member, { contextPct: pct });
                this.updateWidget();
              }
            }
          } catch {}
        }
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
        const lastWork =
          full
            .split("\n")
            .filter((l: string) => l.trim())
            .pop() || "";

        this.agent.updateTeamState(member, {
          status: exitCode === 0 ? "done" : "error",
          output: full,
          elapsed,
          runCount: teamState.runCount + 1,
          lastWork,
        });

        this.updateWidget();

        ctx.ui.notify(
          `${member} ${exitCode === 0 ? "done" : "error"} in ${Math.round(elapsed / 1000)}s`,
          exitCode === 0 ? "success" : "error",
        );

        resolve({
          output: full,
          exitCode,
          elapsed,
        });
      });

      proc.on("error", (err) => {
        clearInterval(timer);
        this.agent.updateTeamState(member, {
          status: "error",
          output: `Error spawning agent: ${err.message}`,
          elapsed: Date.now() - startTime,
        });
        this.updateWidget();
        resolve({
          output: `Error spawning agent: ${err.message}`,
          exitCode: 1,
          elapsed: Date.now() - startTime,
        });
      });
    });
  }

  private registerCommands(): void {
    this.pi.registerCommand("team-grid", {
      description: "Set grid columns: /team-grid <1-6>",
      handler: async (args, ctx) => {
        const n = parseInt(args?.trim() || "", 10);
        if (n >= 1 && n <= 6) {
          this.gridCols = n;
          this.updateWidget();
          ctx.ui.notify(`Grid set to ${n} columns`, "info");
        } else {
          ctx.ui.notify("Usage: /team-grid <1-6>", "warning");
        }
      },
    });

    this.pi.registerCommand("team-clear", {
      description: "Return to single mode: /team-clear",
      handler: async (_args, ctx) => {
        this.agent.setTeamMembers([]);
        this.agent.setMode("single");
        this.pi.setActiveTools([]);
        ctx.ui.setWidget("agent-team", undefined);
        ctx.ui.setStatus("agent-team", undefined);
        ctx.ui.notify("Returned to single mode.", "info");
      },
    });

    this.pi.registerCommand("team", {
      description: "Build team: /team",
      handler: async (args, ctx) => {
        this.widgetCtx = ctx;
        const profiles = this.agent.getProfiles();
        if (!Array.isArray(profiles) || profiles.length === 0) {
          ctx.ui.notify("No profiles found in .pi/agents/", "warning");
          return;
        }

        const validProfiles = profiles.filter(
          (p) => p && typeof p.name === "string",
        );

        if (args?.trim()) {
          const sub = args.trim().toLowerCase();
          if (sub === "list") {
            const members = this.agent.getTeamMembers();
            if (members.length === 0) {
              ctx.ui.notify("No team members. Use /team to build one.", "info");
              return;
            }
            const list = members
              .map((m) => {
                const state = this.agent.getTeamState(m);
                const session =
                  state?.sessionFile && existsSync(state.sessionFile)
                    ? "resumed"
                    : "new";
                return `${m} (${state?.status || "idle"}, ${session}, runs: ${state?.runCount || 0})`;
              })
              .join("\n");
            ctx.ui.notify(list, "info");
            return;
          }
          if (sub === "clear") {
            this.agent.setTeamMembers([]);
            this.agent.setMode("single");
            this.pi.setActiveTools([]);
            ctx.ui.setStatus("agent-team", undefined);
            ctx.ui.notify("Team cleared. Returned to single mode.", "info");
            return;
          }
          if (sub.startsWith("add ")) {
            const name = sub.slice(4).trim();
            const profile = validProfiles.find(
              (p) => p.name.toLowerCase() === name.toLowerCase(),
            );
            if (!profile) {
              ctx.ui.notify(`Profile "${name}" not found.`, "warning");
              return;
            }
            const members = this.agent.getTeamMembers();
            if (!members.includes(profile.name)) {
              members.push(profile.name);
              this.agent.setTeamMembers(members);
              this.agent.setTeamState(profile.name, "$INPUT");
            }
            this.agent.setMode("team");
            this.updateWidget();
            ctx.ui.notify(`Added ${profile.name} to team.`, "info");
            return;
          }
          if (sub.startsWith("remove ")) {
            const name = sub.slice(7).trim();
            const members = this.agent.getTeamMembers();
            const idx = members.findIndex(
              (m) => m.toLowerCase() === name.toLowerCase(),
            );
            if (idx >= 0) {
              members.splice(idx, 1);
              this.agent.setTeamMembers(members);
              if (members.length === 0) {
                this.agent.setMode("single");
              }
              this.updateWidget();
              ctx.ui.notify(`Removed ${name} from team.`, "info");
              return;
            }
            ctx.ui.notify(`Member "${name}" not found in team.`, "warning");
            return;
          }
        }

        const currentTeam = this.agent.getTeamMembers();
        const currentStates = new Map<string, string>();
        for (const name of currentTeam) {
          const state = this.agent.getTeamState(name);
          if (state) currentStates.set(name, state.prompt);
        }

        const items: TeamItem[] = validProfiles.map((p) => ({
          name: p.name,
          selected: currentTeam.includes(p.name),
          prompt: currentStates.get(p.name) || "$INPUT",
        }));

        let cachedLines: string[] | undefined;

        const result = await ctx.ui.custom<TeamResult>(
          (tui, theme, _kb, done) => {
            let cursor = 0;
            let promptMode = false;
            let promptTarget = "";
            const promptInput = new Input();
            promptInput.setValue(items[cursor].prompt);

            const selectedItems = () => items.filter((i) => i.selected);

            const refresh = () => {
              cachedLines = undefined;
              tui.requestRender();
            };

            const render = (width: number): string[] => {
              if (cachedLines) return cachedLines;

              const steps = selectedItems();
              const lines: string[] = [];
              lines.push(theme.fg("dim", "─".repeat(width)));
              lines.push(theme.fg("accent", " Interactive Team Builder "));
              lines.push("");

              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const check = item.selected ? "[x]" : "[ ]";
                const prefix = i === cursor ? theme.fg("accent", ">") : " ";
                const checkColor = item.selected ? "success" : "dim";
                const name =
                  i === cursor ? theme.fg("text", item.name) : item.name;
                lines.push(`${prefix} ${theme.fg(checkColor, check)}: ${name}`);
              }

              lines.push("");
              lines.push(theme.fg("dim", "─".repeat(width)));
              lines.push(theme.fg("dim", "Current Team:"));
              if (steps.length === 0) {
                lines.push(theme.fg("dim", " (empty)"));
              } else {
                const teamDisplay = steps
                  .map((s, i) => {
                    return i === 0
                      ? theme.fg("accent", s.name)
                      : theme.fg("dim", ",") + theme.fg("accent", s.name);
                  })
                  .join(" ");
                lines.push(teamDisplay);
              }
              lines.push("");
              lines.push(
                theme.fg(
                  "dim",
                  "[Space] Toggle  [P] Set Prompt  [A] Select All  [C] Clear All  [Enter] Confirm  [Esc] Cancel",
                ),
              );
              lines.push(theme.fg("dim", "─".repeat(width)));

              if (promptMode) {
                lines.push("");
                lines.push(
                  theme.fg(
                    "accent",
                    `──[${promptTarget}]${"─".repeat(Math.max(0, width - promptTarget.length - 5))}`,
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
                  promptInput.setValue(items[cursor].prompt);
                } else if (data === "enter" || matchesKey(data, Key.enter)) {
                  items[cursor].prompt = promptInput.getValue() || "$INPUT";
                  promptMode = false;
                } else {
                  promptInput.handleInput(data);
                }
                refresh();
                return;
              }

              if (data === "up" || matchesKey(data, Key.up))
                cursor = Math.max(0, cursor - 1);
              if (data === "down" || matchesKey(data, Key.down))
                cursor = Math.min(items.length - 1, cursor + 1);
              if (data === " " || matchesKey(data, Key.space)) {
                items[cursor].selected = !items[cursor].selected;
              }
              if (data === "p" || data === "P") {
                if (items[cursor].selected) {
                  promptMode = true;
                  promptTarget = items[cursor].name;
                  promptInput.setValue(items[cursor].prompt);
                }
              }
              if (data === "a" || data === "A") {
                for (const item of items) item.selected = true;
              }
              if (data === "c" || data === "C") {
                for (const item of items) item.selected = false;
              }
              if (data === "enter" || matchesKey(data, Key.enter)) {
                const selected = selectedItems();
                if (selected.length === 0) {
                  done(void 0 as unknown as TeamResult);
                } else {
                  done({ members: selected });
                }
              }
              if (data === "escape" || matchesKey(data, Key.escape)) {
                done(void 0 as unknown as TeamResult);
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
          },
        );

        if (result?.members && result.members.length > 0) {
          for (const item of result.members) {
            this.agent.setTeamState(item.name, item.prompt);
          }
          this.agent.setTeamMembers(result.members.map((m) => m.name));
          this.agent.setMode("team");
          this.pi.setActiveTools(["dispatch_agent"]);
          this.updateWidget();

          const size = result.members.length;
          this.gridCols = size <= 3 ? size : size === 4 ? 2 : 3;

          ctx.ui.setStatus("agent-team", `Team (${size})`);
          ctx.ui.notify(
            `Team activated: ${result.members.map((m) => m.name).join(", ")}\n` +
            `Supervisor will delegate tasks to team members.\n` +
            `/team        Modify team\n` +
            `/team-grid   Set columns\n` +
            `/team-clear  Return to single mode`,
            "info",
          );
        }
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "dispatch_agent",
      label: "Dispatch Agent",
      description:
        "Dispatch a task to a specialist agent. The agent will execute the task and return the result.",
      parameters: Type.Object({
        agent: Type.String({ description: "Agent name (case-insensitive)" }),
        task: Type.String({
          description: "Task description for the agent to execute",
        }),
      }),

      execute: async (_toolCallId, params, _signal, onUpdate, ctx) => {
        const { agent, task } = params as { agent: string; task: string };

        if (onUpdate) {
          onUpdate({
            content: [{ type: "text", text: `Dispatching to ${agent}...` }],
            details: { agent, task, status: "dispatching" },
          });
        }

        const result = await this.dispatchAgent(agent, task, ctx);

        const truncated =
          result.output.length > 8000
            ? result.output.slice(0, 8000) + "\n\n... [truncated]"
            : result.output;

        const status = result.exitCode === 0 ? "done" : "error";
        const summary = `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

        return {
          content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
          details: {
            agent,
            task,
            status,
            elapsed: result.elapsed,
            exitCode: result.exitCode,
            fullOutput: result.output,
          },
        };
      },

      renderCall(args, theme) {
        const agentName = (args as any).agent || "?";
        const task = (args as any).task || "";
        const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
        return new Text(
          theme.fg("toolTitle", theme.bold("dispatch_agent ")) +
            theme.fg("accent", agentName) +
            theme.fg("dim", " — ") +
            theme.fg("muted", preview),
          0,
          0,
        );
      },

      renderResult(result, options, theme) {
        const details = result.details as TeamDispatchState;
        if (!details) {
          const text = result.content[0];
          return new Text(text?.type === "text" ? text.text : "", 0, 0);
        }

        if (options.isPartial || details.status === "dispatching") {
          return new Text(
            theme.fg("accent", `● ${details.agentName || "?"}`) +
              theme.fg("dim", " working..."),
            0,
            0,
          );
        }

        const icon = details.status === "done" ? "✓" : "✗";
        const color = details.status === "done" ? "success" : "error";
        const elapsed =
          typeof details.elapsed === "number"
            ? Math.round(details.elapsed / 1000)
            : 0;
        const header =
          theme.fg(color, `${icon} ${details.agentName}`) +
          theme.fg("dim", ` ${elapsed}s`);

        if (options.expanded && details.fullOutput) {
          const output =
            details.fullOutput.length > 4000
              ? details.fullOutput.slice(0, 4000) + "\n... [truncated]"
              : details.fullOutput;
          return new Text(header + "\n" + theme.fg("muted", output), 0, 0);
        }

        return new Text(header, 0, 0);
      },
    });
  }

  private registerTeamTools(): void {
    this.pi.registerTool({
      name: "create_team",
      label: "Create Team",
      description: "Create and activate a team of specialist agents for complex tasks",
      parameters: Type.Object({
        agents: Type.Array(Type.String(), {
          description: "Agent names to include in the team",
        }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const profiles = this.agent.getProfiles();
        const validProfiles = profiles.filter(
          (p) => p && typeof p.name === "string",
        );

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
              {
                type: "text",
                text: "No valid agents specified. Use available_agents to see available agents.",
              },
            ],
            details: undefined,
          };
        }

        const members: string[] = [];
        for (const name of valid) {
          members.push(name);
          this.agent.setTeamState(name, "$INPUT");
        }

        this.agent.setTeamMembers(members);
        this.agent.setMode("team");
        this.pi.setActiveTools(["dispatch_agent", "clear_team"]);
        this.agent.registerTeamWidget(ctx);
        ctx.ui.setStatus("agent-team", `Team (${members.length})`);
        ctx.ui.notify(`Team created: ${members.join(", ")}`, "info");

        return {
          content: [
            {
              type: "text",
              text: `Team created with ${members.length} agents: ${members.join(", ")}\nUse dispatch_agent to delegate tasks to team members.`,
            },
          ],
          details: undefined,
        };
      },
    });

    this.pi.registerTool({
      name: "clear_team",
      label: "Clear Team",
      description: "Clear the current team and return to single agent mode",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
        const members = this.agent.getTeamMembers();

        if (members.length === 0) {
          return {
            content: [
              { type: "text", text: "No team to clear. Already in single mode." },
            ],
            details: undefined,
          };
        }

        const count = members.length;
        this.agent.setTeamMembers([]);
        this.agent.setMode("single");
        this.pi.setActiveTools([]);
        ctx.ui.setWidget("agent-team", undefined);
        ctx.ui.setStatus("agent-team", undefined);
        ctx.ui.notify(`Team cleared. Returned to single mode.`, "info");

        return {
          content: [
            {
              type: "text",
              text: `Team cleared. ${count} agents removed. Returned to single agent mode.`,
            },
          ],
          details: undefined,
        };
      },
    });
  }

  public setContextWindow(ctx: any): void {
    this.contextWindow = ctx.model?.contextWindow || 0;
  }

  public restrictToDispatchAgent(): void {
    this.pi.setActiveTools(["dispatch_agent"]);
  }

  public clearAgentSessions(cwd: string): void {
    const sessDir = join(cwd, ".pi", "agent-sessions");
    try {
      if (existsSync(sessDir)) {
        for (const f of readdirSync(sessDir)) {
          if (f.endsWith(".json")) {
            try {
              unlinkSync(join(sessDir, f));
            } catch {}
          }
        }
      }
    } catch {}
  }
}
