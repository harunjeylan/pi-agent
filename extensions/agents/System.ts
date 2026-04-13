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
                text: `Agent "${params.agent}" not found. Use list_agents to see available agents.`,
              },
            ],
          };
        }
        this.agent.setSystemAgent(params.agent);
        return {
          content: [{ type: "text", text: `Switched to ${params.agent}` }],
        };
      },
    });

    this.pi.registerTool({
      name: "list_agents",
      description: "List all available agent profiles",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        const profiles = this.agent.getProfiles();
        const validProfiles = profiles.filter(
          (p) => p && typeof p.name === "string",
        );
        if (validProfiles.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No agents available. Create profiles in .pi/agents/",
              },
            ],
          };
        }
        const list = validProfiles
          .map((p) => `- ${p.name}: ${p.description || "No description"}`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Available agents:\n${list}` }],
        };
      },
    });
  }
}
