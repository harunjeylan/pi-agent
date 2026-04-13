import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { Agent } from "./Agent";

export class SwarmManager {
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
    this.pi.registerCommand("swarm-grid", {
      description: "Set grid columns: /swarm-grid <1-6>",
      handler: async (args, ctx) => {
        const n = parseInt(args?.trim() || "", 10);
        if (n >= 1 && n <= 6) {
          this.gridCols = n;
          this.agent.registerSwarmWidget(ctx);
          ctx.ui.notify(`Grid set to ${n} columns`, "info");
        } else {
          ctx.ui.notify("Usage: /swarm-grid <1-6>", "warning");
        }
      },
    });

    this.pi.registerCommand("swarm", {
      description: "Spawn background agents: /swarm <task>",
      handler: async (args, ctx) => {
        if (!args?.trim()) {
          const swarmAgents = this.agent.getSwarmAgents();
          if (swarmAgents.size === 0) {
            ctx.ui.notify("No active swarm agents. Use /swarm <task> to spawn one.", "info");
            return;
          }
          const list = Array.from(swarmAgents.values())
            .map(a => `[${a.id}] ${a.status}: ${a.task.slice(0, 50)}`)
            .join("\n");
          ctx.ui.notify(`Swarm agents:\n${list}`, "info");
          return;
        }

        const task = args.trim();
        const swarmAgent = this.agent.createSwarmAgent(task);
        this.runSwarmAgent(swarmAgent.id, task);
        this.agent.setMode("swarm");
        this.agent.registerSwarmWidget(ctx);
        ctx.ui.notify(`Spawned swarm agent ${swarmAgent.id}: ${task.slice(0, 40)}...`, "info");
      },
    });

    this.pi.registerCommand("swarm-list", {
      description: "List swarm agents: /swarm-list",
      handler: async (_args, ctx) => {
        const swarmAgents = this.agent.getSwarmAgents();
        if (swarmAgents.size === 0) {
          ctx.ui.notify("No active swarm agents.", "info");
          return;
        }
        const list = Array.from(swarmAgents.values())
          .map(a => `[${a.id}] ${a.status}: ${a.task.slice(0, 40)} (${a.elapsed}ms)`)
          .join("\n");
        ctx.ui.notify(`Swarm agents:\n${list}`, "info");
      },
    });

    this.pi.registerCommand("swarm-rm", {
      description: "Remove swarm agent: /swarm-rm <id>",
      handler: async (args, ctx) => {
        const id = parseInt(args?.trim() || "");
        if (isNaN(id)) {
          ctx.ui.notify("Usage: /swarm-rm <id>", "warning");
          return;
        }
        const removed = this.agent.getSwarmAgent(id);
        if (!removed) {
          ctx.ui.notify(`Swarm agent ${id} not found.`, "warning");
          return;
        }
        this.agent.removeSwarmAgent(id);
        ctx.ui.setWidget(`swarm-${id}`, undefined);
        ctx.ui.notify(`Removed swarm agent ${id}`, "info");
      },
    });

    this.pi.registerCommand("swarm-clear", {
      description: "Clear all swarm agents: /swarm-clear",
      handler: async (_args, ctx) => {
        for (const [id] of this.agent.getSwarmAgents()) {
          this.agent.removeSwarmAgent(id);
          ctx.ui.setWidget(`swarm-${id}`, undefined);
        }
        ctx.ui.notify("Cleared all swarm agents.", "info");
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "swarm_create",
      description: "Spawn a background swarm agent",
      parameters: Type.Object({
        task: Type.String({ description: "Task to assign to the swarm agent" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const swarmAgent = this.agent.createSwarmAgent(params.task);
        this.runSwarmAgent(swarmAgent.id, params.task);
        return { content: [{ type: "text", text: `Spawned swarm agent ${swarmAgent.id}` }] };
      },
    });

    this.pi.registerTool({
      name: "swarm_continue",
      description: "Continue a swarm agent conversation",
      parameters: Type.Object({
        id: Type.Number({ description: "Swarm agent ID" }),
        prompt: Type.String({ description: "Prompt to send to the agent" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const swarmAgent = this.agent.getSwarmAgent(params.id);
        if (!swarmAgent) {
          return { content: [{ type: "text", text: `Swarm agent ${params.id} not found` }] };
        }
        if (swarmAgent.status === "running") {
          return { content: [{ type: "text", text: `Swarm agent ${params.id} is still running` }] };
        }
        this.runSwarmAgent(params.id, params.prompt, true);
        return { content: [{ type: "text", text: `Continued swarm agent ${params.id}` }] };
      },
    });

    this.pi.registerTool({
      name: "swarm_remove",
      description: "Remove a swarm agent",
      parameters: Type.Object({
        id: Type.Number({ description: "Swarm agent ID to remove" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const swarmAgent = this.agent.getSwarmAgent(params.id);
        if (!swarmAgent) {
          return { content: [{ type: "text", text: `Swarm agent ${params.id} not found` }] };
        }
        this.agent.removeSwarmAgent(params.id);
        return { content: [{ type: "text", text: `Removed swarm agent ${params.id}` }] };
      },
    });

    this.pi.registerTool({
      name: "swarm_list",
      description: "List all swarm agents",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        const swarmAgents = this.agent.getSwarmAgents();
        if (swarmAgents.size === 0) {
          return { content: [{ type: "text", text: "No active swarm agents" }] };
        }
        const list = Array.from(swarmAgents.values())
          .map(a => `[${a.id}] ${a.status}: ${a.task.slice(0, 40)}`)
          .join("\n");
        return { content: [{ type: "text", text: `Swarm agents:\n${list}` }] };
      },
    });
  }

  private runSwarmAgent(id: number, task: string, continueSession = false): void {
    const swarmAgent = this.agent.getSwarmAgent(id);
    if (!swarmAgent) return;

    this.agent.updateSwarmAgent(id, { status: "running" });

    const model = "openrouter/google/gemini-3-flash-preview";
    const tools = "read,bash,grep,find,ls,edit,glob,webfetch";
    const sessionFile = swarmAgent.sessionFile;
    const hasSession = existsSync(sessionFile);

    const args = [
      "--mode", "json",
      "-p",
      "--no-extensions",
      "--model", model,
      "--tools", tools,
      "--session", sessionFile,
    ];

    if (hasSession || continueSession) {
      args.push("-c");
    }

    args.push(task);

    const startTime = Date.now();
    const proc = spawn("pi", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.agent.updateSwarmAgent(id, { proc });

    let output = "";
    let errorOutput = "";

    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    const timeout = 300000;
    const timer = setTimeout(() => {
      proc.kill();
      this.agent.updateSwarmAgent(id, {
        status: "error",
        output: "Timeout: Agent exceeded maximum runtime",
        elapsed: timeout,
      });
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;
      this.agent.updateSwarmAgent(id, {
        status: code === 0 ? "done" : "error",
        output: output || errorOutput,
        elapsed,
      });

      this.pi.emit("swarm_complete", { id, output: output || errorOutput });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      this.agent.updateSwarmAgent(id, {
        status: "error",
        output: `Error: ${err.message}`,
        elapsed: Date.now() - startTime,
      });
    });
  }
}