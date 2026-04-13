import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Agent } from "./Agent";

export class SystemManager {
  private pi: ExtensionAPI;
  private agent: Agent;

  constructor(pi: ExtensionAPI, agent: Agent) {
    this.pi = pi;
    this.agent = agent;
    this.registerCommands();
    this.registerTools();
    this.registerListeners();
  }

  private registerListeners(): void {
    this.pi.on("before_agent_start", async (_event, ctx) => {
      if (this.agent.getMode() !== "single") {
        return {};
      }

      const profiles = this.agent.getProfiles();
      const agentList = profiles
        .map((p) => `- ${p.name}: ${p.description || "No description"}`)
        .join("\n");

      return {
        systemPrompt: `

## Team Mode
For complex tasks requiring multiple skills, create a team of specialists:
- Use available_agents to see available specialist agents
- Use create_team to create and activate a team
- Use dispatch_agent to delegate tasks to team members

Available agents:
${agentList}`,
      };
    });
  }

  private registerCommands(): void {
    this.pi.registerCommand("system", {
      description: "Select agent profile: /system",
      handler: async (args, ctx) => {
        const profiles = this.agent.getProfiles();

        if (!Array.isArray(profiles) || profiles.length === 0) {
          ctx.ui.notify("No profiles found in .pi/agents/", "warning");
          return;
        }

        const validProfiles = profiles.filter(
          (p) => p && typeof p.name === "string",
        );
        if (validProfiles.length === 0) {
          ctx.ui.notify("No valid profiles found.", "warning");
          return;
        }

        if (args?.trim()) {
          const target = args.trim().toLowerCase();
          const profile = validProfiles.find(
            (p) =>
              p.name.toLowerCase() === target ||
              p.name.toLowerCase().replace(/\s+/g, "-") === target,
          );
          if (profile) {
            this.agent.setSystemAgent(profile.name);
            ctx.ui.notify(`Profile: ${profile.name}`, "info");
            return;
          }
          ctx.ui.notify(
            `Profile not found: ${args}. Use /system to see available profiles.`,
            "warning",
          );
          return;
        }

        const options = validProfiles.map((p) => p.name);
        const choice = await ctx.ui.select("Select Profile", options);
        if (choice !== undefined) {
          this.agent.setSystemAgent(choice);
          ctx.ui.notify(`Profile: ${choice}`, "info");
        }
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "switch_system",
      label: "Switch System",
      description: "Switch the system agent to a different profile",
      parameters: Type.Object({
        agent: Type.String({ description: "Agent name to switch to" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const profile = this.agent.getProfile(params.agent);
        if (!profile) {
          return {
            content: [
              {
                type: "text",
                text: `Agent "${params.agent}" not found. Use available_agents to see available agents.`,
              },
            ],
            details: undefined,
          };
        }
        this.agent.setSystemAgent(params.agent);
        return {
          content: [{ type: "text", text: `Switched to ${params.agent}` }],
          details: undefined,
        };
      },
    });
  }
}
