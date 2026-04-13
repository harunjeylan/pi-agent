import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { Agent } from "./Agent";

export class SwarmManager {
  private pi: ExtensionAPI;
  private agent: Agent;
  private gridCols = 2;
  private widgetCtx: any;

  constructor(pi: ExtensionAPI, agent: Agent) {
    this.pi = pi;
    this.agent = agent;
    this.registerCommands();
    this.registerTools();
  }

  private updateWidgets(): void {
    if (!this.widgetCtx) return;
    for (const [id, state] of this.agent.getSwarmAgents()) {
      this.widgetCtx.ui.setWidget(`swarm-${id}`, (_tui: any, theme: any) => {
        const statusColor = state.status === "running" ? "accent"
          : state.status === "done" ? "success" : "error";
        const statusIcon = state.status === "running" ? "●"
          : state.status === "done" ? "✓" : "✗";

        const taskPreview = state.task.length > 40
          ? state.task.slice(0, 37) + "..."
          : state.task;

        const turnLabel = state.turnCount > 1
          ? ` · Turn ${state.turnCount}`
          : "";

        const ctxStr = state.contextPct > 0 ? ` 📊${Math.round(state.contextPct)}%` : "";

        const lines = [
          `${statusIcon} Swarm #${state.id}${turnLabel}  ${taskPreview}  (${Math.round(state.elapsed / 1000)}s) 🛠${state.toolCount}${ctxStr}`,
        ];

        const lastLine = state.output.split("\n").filter((l: string) => l.trim()).pop() || "";
        if (lastLine) {
          const trimmed = lastLine.length > 80 ? lastLine.slice(0, 77) + "..." : lastLine;
          lines.push(trimmed);
        }

        return {
          render(width: number): string[] {
            return lines.map(l => l.slice(0, width));
          },
          invalidate() {},
        };
      });
    }
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
        this.widgetCtx = ctx;
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
        this.runSwarmAgent(swarmAgent.id, task, ctx);
        this.agent.setMode("swarm");
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
          .map(a => `[${a.id}] ${a.status}: ${a.task.slice(0, 40)} (${Math.round(a.elapsed / 1000)}s)`)
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
        removed._removed = true;
        if (removed.proc && removed.status === "running") {
          removed.proc.kill("SIGTERM");
        }
        this.agent.removeSwarmAgent(id);
        ctx.ui.setWidget(`swarm-${id}`, undefined);
        ctx.ui.notify(`Removed swarm agent ${id}`, "info");
      },
    });

    this.pi.registerCommand("swarm-clear", {
      description: "Clear all swarm agents: /swarm-clear",
      handler: async (_args, ctx) => {
        for (const [id, agent] of this.agent.getSwarmAgents()) {
          agent._removed = true;
          if (agent.proc && agent.status === "running") {
            agent.proc.kill("SIGTERM");
          }
          ctx.ui.setWidget(`swarm-${id}`, undefined);
        }
        ctx.ui.notify("Cleared all swarm agents.", "info");
      },
    });
  }

  private registerTools(): void {
    this.pi.registerTool({
      name: "swarm_create",
      label: "Swarm Create",
      description: "Spawn a background swarm agent",
      parameters: Type.Object({
        task: Type.String({ description: "Task to assign to the swarm agent" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        this.widgetCtx = ctx;
        const swarmAgent = this.agent.createSwarmAgent(params.task);
        this.runSwarmAgent(swarmAgent.id, params.task, ctx);
        return { content: [{ type: "text", text: `Spawned swarm agent ${swarmAgent.id}` }], details: undefined };
      },
    });

    this.pi.registerTool({
      name: "swarm_continue",
      label: "Swarm Continue",
      description: "Continue a swarm agent conversation",
      parameters: Type.Object({
        id: Type.Number({ description: "Swarm agent ID" }),
        prompt: Type.String({ description: "Prompt to send to the agent" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const swarmAgent = this.agent.getSwarmAgent(params.id);
        if (!swarmAgent) {
          return { content: [{ type: "text", text: `Swarm agent ${params.id} not found` }], details: undefined };
        }
        if (swarmAgent.status === "running") {
          return { content: [{ type: "text", text: `Swarm agent ${params.id} is still running` }], details: undefined };
        }
        this.runSwarmAgent(params.id, params.prompt, ctx, true);
        return { content: [{ type: "text", text: `Continued swarm agent ${params.id}` }], details: undefined };
      },
    });

    this.pi.registerTool({
      name: "swarm_remove",
      label: "Swarm Remove",
      description: "Remove a swarm agent",
      parameters: Type.Object({
        id: Type.Number({ description: "Swarm agent ID to remove" }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const swarmAgent = this.agent.getSwarmAgent(params.id);
        if (!swarmAgent) {
          return { content: [{ type: "text", text: `Swarm agent ${params.id} not found` }], details: undefined };
        }
        swarmAgent._removed = true;
        if (swarmAgent.proc && swarmAgent.status === "running") {
          swarmAgent.proc.kill("SIGTERM");
        }
        this.agent.removeSwarmAgent(params.id);
        ctx.ui.setWidget(`swarm-${params.id}`, undefined);
        return { content: [{ type: "text", text: `Removed swarm agent ${params.id}` }], details: undefined };
      },
    });

    this.pi.registerTool({
      name: "swarm_list",
      label: "Swarm List",
      description: "List all swarm agents",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        const swarmAgents = this.agent.getSwarmAgents();
        if (swarmAgents.size === 0) {
          return { content: [{ type: "text", text: "No active swarm agents" }], details: undefined };
        }
        const list = Array.from(swarmAgents.values())
          .map(a => `[${a.id}] ${a.status}: ${a.task.slice(0, 40)}`)
          .join("\n");
        return { content: [{ type: "text", text: `Swarm agents:\n${list}` }], details: undefined };
      },
    });
  }

  private processLine(state: any, line: string): void {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      const type = event.type;

      if (type === "message_update") {
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_delta") {
          state.output += delta.delta || "";
          this.updateWidgets();
        }
      } else if (type === "tool_execution_start") {
        state.toolCount++;
        this.updateWidgets();
      }
    } catch {}
  }

  private runSwarmAgent(id: number, task: string, ctx: any, continueSession = false): void {
    const swarmAgent = this.agent.getSwarmAgent(id);
    if (!swarmAgent) return;

    this.widgetCtx = ctx;
    swarmAgent.status = "running";
    swarmAgent.output = "";
    swarmAgent.toolCount = 0;
    swarmAgent.elapsed = 0;
    swarmAgent._removed = false;
    if (continueSession) {
      swarmAgent.turnCount = (swarmAgent.turnCount || 1) + 1;
    }
    this.updateWidgets();

    const model = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "openrouter/google/gemini-3-flash-preview";
    const tools = "read,bash,grep,find,ls,edit";
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
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.agent.updateSwarmAgent(id, { proc });

    const timer = setInterval(() => {
      swarmAgent.elapsed = Date.now() - startTime;
      this.updateWidgets();
    }, 1000);

    let buffer = "";

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        this.processLine(swarmAgent, line);
      }
    });

    proc.stderr!.setEncoding("utf-8");
    proc.stderr!.on("data", (chunk: string) => {
      if (chunk.trim()) {
        swarmAgent.output += chunk;
        this.updateWidgets();
      }
    });

    const timeout = 300000;
    const timeoutTimer = setTimeout(() => {
      proc.kill("SIGTERM");
      this.agent.updateSwarmAgent(id, {
        status: "error",
        output: "Timeout: Agent exceeded maximum runtime",
        elapsed: timeout,
      });
      this.updateWidgets();
    }, timeout);

    proc.on("close", (code) => {
      clearInterval(timer);
      clearTimeout(timeoutTimer);

      if (swarmAgent._removed) {
        return;
      }

      if (buffer.trim()) {
        this.processLine(swarmAgent, buffer);
      }
      const elapsed = Date.now() - startTime;
      const finalStatus = code === 0 ? "done" : "error";
      this.agent.updateSwarmAgent(id, {
        status: finalStatus,
        elapsed,
      });
      this.updateWidgets();

      const result = swarmAgent.output;
      const truncated = result.length > 8000 ? result.slice(0, 8000) + "\n\n... [truncated]" : result;

      ctx.ui.notify(
        `Swarm #${id} ${finalStatus} in ${Math.round(elapsed / 1000)}s`,
        finalStatus === "done" ? "success" : "error"
      );

      this.pi.sendMessage({
        customType: "swarm-result",
        content: `Swarm #${id}${swarmAgent.turnCount > 1 ? ` (Turn ${swarmAgent.turnCount})` : ""} finished "${task}" in ${Math.round(elapsed / 1000)}s.\n\nResult:\n${truncated}`,
        display: true,
      }, { deliverAs: "followUp", triggerTurn: true });
    });

    proc.on("error", (err) => {
      clearInterval(timer);
      clearTimeout(timeoutTimer);
      this.agent.updateSwarmAgent(id, {
        status: "error",
        output: `Error: ${err.message}`,
        elapsed: Date.now() - startTime,
      });
      this.updateWidgets();
    });
  }
}