import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Agent } from "./Agent";
import { SystemManager } from "./System";
import { SwarmManager } from "./Swarm";
import { TeamManager } from "./Team";
import { ChainManager } from "./Chain";

export default function Agents(pi: ExtensionAPI): void {
  const agent = new Agent(pi);

  new SystemManager(pi, agent);
  new SwarmManager(pi, agent);
  new TeamManager(pi, agent);
  new ChainManager(pi, agent);

  pi.on("session_start", async (_event, ctx) => {
    agent.initialize(ctx.cwd);

    agent.clearWidgets(ctx);

    const mode = agent.getMode();
    if (mode === "team") {
      agent.registerTeamWidget(ctx);
    } else if (mode === "chain") {
      agent.registerChainWidget(ctx);
    } else if (mode === "swarm") {
      agent.registerSwarmWidget(ctx);
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          let tokIn = 0;
          let tokOut = 0;
          let cost = 0;
          for (const entry of ctx.sessionManager.getBranch()) {
            if (
              entry.type === "message" &&
              entry.message.role === "assistant"
            ) {
              const m = entry.message;
              tokIn += m.usage.input;
              tokOut += m.usage.output;
              cost += m.usage.cost.total;
            }
          }

          const fmt = (n: number) =>
            n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;

          const usage = ctx.getContextUsage();
          const pct = usage ? usage.percent : 0;
          const filled = Math.round((pct || 0) / 10) || 1;
          const model = ctx.model?.id || "no-model";

          const sesAgent = agent.getSystemAgent()?.name;
          const l1Left =
            (sesAgent ? theme.fg("dim", ` ${sesAgent}:`) : "") +
            theme.fg("dim", ` (${model})`) +
            theme.fg("warning", "[") +
            theme.fg("success", "#".repeat(filled)) +
            theme.fg("dim", "-".repeat(10 - filled)) +
            theme.fg("warning", "]") +
            theme.fg("dim", " ") +
            theme.fg("accent", `${Math.round(pct || 0)}%`);

          const l1Right =
            theme.fg("success", `${fmt(tokIn)}`) +
            theme.fg("dim", " in ") +
            theme.fg("accent", `${fmt(tokOut)}`) +
            theme.fg("dim", " out ") +
            theme.fg("warning", `$${cost.toFixed(4)}`) +
            theme.fg("dim", " ");

          const pad1 = " ".repeat(
            Math.max(1, width - visibleWidth(l1Left) - visibleWidth(l1Right)),
          );
          const line1 = truncateToWidth(l1Left + pad1 + l1Right, width, "");

          const dir = ctx.cwd.split("/").pop() || ctx.cwd;
          const branch = footerData.getGitBranch();
          const l2Left =
            theme.fg("dim", ` ${dir}`) +
            (branch
              ? theme.fg("dim", " ") +
                theme.fg("warning", "(") +
                theme.fg("success", branch) +
                theme.fg("warning", ")")
              : "");

          const mode = agent.getMode();
          const l2Right = theme.fg("dim", `mode: ${mode} `);

          const pad2 = " ".repeat(
            Math.max(1, width - visibleWidth(l2Left) - visibleWidth(l2Right)),
          );
          const line2 = truncateToWidth(l2Left + pad2 + l2Right, width, "");

          return [line1, line2];
        },
      };
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    return agent.getSystemPrompt(event.systemPrompt);
  });
}