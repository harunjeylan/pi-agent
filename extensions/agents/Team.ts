import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Input, Key, matchesKey } from "@mariozechner/pi-tui";
import { Agent } from "./Agent";

interface TeamItem {
  name: string;
  selected: boolean;
  prompt: string;
}

interface TeamResult {
  members: TeamItem[];
}

export class TeamManager {
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
    this.pi.registerCommand("team-grid", {
      description: "Set grid columns: /team-grid <1-6>",
      handler: async (args, ctx) => {
        const n = parseInt(args?.trim() || "", 10);
        if (n >= 1 && n <= 6) {
          this.gridCols = n;
          this.agent.registerTeamWidget(ctx);
          ctx.ui.notify(`Grid set to ${n} columns`, "info");
        } else {
          ctx.ui.notify("Usage: /team-grid <1-6>", "warning");
        }
      },
    });

    this.pi.registerCommand("team", {
      description: "Build team: /team",
      handler: async (args, ctx) => {
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
            ctx.ui.notify(`Team: ${members.join(", ")}`, "info");
            return;
          }
          if (sub === "clear") {
            this.agent.setTeamMembers([]);
            this.agent.setMode("single");
            ctx.ui.notify("Team cleared.", "info");
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
            const promptInput = new Input();
            promptInput.value = items[cursor].prompt;

            const selectedItems = () => items.filter((i) => i.selected);

            const refresh = () => {
              cachedLines = undefined;
              tui.requestRender();
            };

            const render = (width: number): string[] => {
              if (cachedLines) return cachedLines;

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
              lines.push(
                theme.fg(
                  "dim",
                  "[Space] Toggle  [P] Set Prompt  [A] Select All  [C] Clear All  [Enter] Confirm  [Esc] Cancel",
                ),
              );
              lines.push(theme.fg("dim", "─".repeat(width)));
              const name = items[cursor].name;
              if (promptMode) {
                lines.push("");
                lines.push(
                  theme.fg(
                    "accent",
                    `──[${name}]${"─".repeat(width - name.length - 5)}`,
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
                  promptInput.value = items[cursor].prompt;
                } else if (data === "enter" || matchesKey(data, Key.enter)) {
                  items[cursor].prompt = promptInput.value || "$INPUT";
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
                  promptInput.value = items[cursor].prompt;
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
                const selected = selectedItems();
                if (selected.length === 0) {
                  done(null);
                } else {
                  done({ members: selected });
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
          },
        );

        if (result?.members && result.members.length > 0) {
          for (const item of result.members) {
            this.agent.setTeamState(item.name, item.prompt);
          }
          this.agent.setTeamMembers(result.members.map((m) => m.name));
          this.agent.setMode("team");
          this.agent.registerTeamWidget(ctx);
          ctx.ui.notify(
            `Team: ${result.members.map((m) => m.name).join(", ")}`,
            "info",
          );
        }
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "dispatch_agent",
      description: "Dispatch a task to a team member",
      parameters: Type.Object({
        agent: Type.String({ description: "Team member name" }),
        task: Type.String({ description: "Task to dispatch" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const members = this.agent.getTeamMembers();
        const member = members.find(
          (m) => m.toLowerCase() === params.agent.toLowerCase(),
        );
        if (!member) {
          return {
            content: [
              {
                type: "text",
                text: `Team member "${params.agent}" not found. Use dispatch_agent with one of: ${members.join(", ") || "none"}`,
              },
            ],
          };
        }

        const teamState = this.agent.getTeamState(member);
        if (!teamState) {
          return {
            content: [
              {
                type: "text",
                text: `No state found for team member "${member}"`,
              },
            ],
          };
        }

        this.agent.updateTeamState(member, {
          status: "running",
          task: params.task,
        });

        const prompt = teamState.prompt.replace(/\$INPUT/g, params.task);
        const result = await this.agent.spawnAgent({
          agentName: member,
          task: prompt,
        });

        this.agent.updateTeamState(member, {
          status: result.exitCode === 0 ? "done" : "error",
          output: result.output,
          elapsed: result.elapsed,
          runCount: teamState.runCount + 1,
        });

        return { content: [{ type: "text", text: result.output }] };
      },
    });
  }
}
