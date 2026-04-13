import { ChildProcess, spawn } from "node:child_process";
import { getAgentDir, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export type AgentMode = "single" | "team" | "chain" | "swarm";

export interface AgentProfile {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  body: string;
}

export interface TeamState {
  name: string;
  prompt: string;
  status: "idle" | "running" | "done" | "error";
  task: string;
  output: string;
  elapsed: number;
  runCount: number;
  sessionFile: string;
  toolCount: number;
  lastWork: string;
  contextPct: number;
}

export interface ChainStep {
  agent: string;
  prompt: string;
}

export interface ChainStepState {
  agent: string;
  status: "pending" | "running" | "done" | "error";
  elapsed: number;
  output: string;
  toolCount: number;
  lastWork: string;
  contextPct: number;
}

export interface SwarmState {
  id: number;
  status: "pending" | "running" | "done" | "error";
  task: string;
  output: string;
  elapsed: number;
  turnCount: number;
  sessionFile: string;
  proc?: ChildProcess;
  toolCount: number;
  lastWork: string;
  contextPct: number;
  _removed?: boolean;
}

export interface SpawnOptions {
  agentName: string;
  task: string;
  sessionKey?: string;
  continueSession?: boolean;
  timeout?: number;
  onStatusChange?: (status: "running" | "done" | "error") => void;
  onElapsedUpdate?: (elapsed: number) => void;
  onLastWorkUpdate?: (work: string) => void;
}

export interface AgentExecutionResult {
  output: string;
  exitCode: number;
  elapsed: number;
  toolCount: number;
  contextPct: number;
}

export class Agent {
  private pi: ExtensionAPI;

  private _initialized = false;
  private _sessionDir = "";

  private activeMode: AgentMode = "single";

  private profiles = new Map<string, AgentProfile>();
  private systemAgent: AgentProfile | null = null;

  private sessions = new Map<string, string>();

  private teamMembers: string[] = [];
  private teamStates = new Map<string, TeamState>();

  private chainSteps: ChainStep[] = [];
  private chainStepStates: ChainStepState[] = [];
  private chainWidgetText: Text | null = null;
  private teamWidgetText: Text | null = null;

  private swarmAgents = new Map<number, SwarmState>();
  private nextSwarmId = 1;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  initialize(cwd: string): void {
    if (this._initialized) return;
    this._sessionDir = join(cwd, ".pi", "agent-sessions");
    this.loadProfiles(cwd);
    this._initialized = true;
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  getSessionDir(): string {
    return this._sessionDir;
  }

  reloadProfiles(cwd: string): void {
    this.profiles.clear();
    this.loadProfiles(cwd);
  }

  private loadProfiles(cwd: string): void {
    const userDir = join(getAgentDir(), "agents");
    const projectDir = join(cwd, ".pi", "agents");
    const locations = [userDir, projectDir];
    try {
      for (const location of locations) {
        if (existsSync(location)) {
          for (const file of readdirSync(location)) {
            if (file.endsWith(".md")) {
              const content = readFileSync(join(location, file), "utf-8");
              const profile = this.parseProfile(content, file);
              this.profiles.set(this.normalizeKey(profile.name), profile);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[Agent] Failed to load user profiles:", err);
    }
  }

  private parseProfile(content: string, filename: string): AgentProfile {
    const lines = content.split("\n");
    let name = filename.replace(".md", "");
    let description = "";
    const frontmatter: Record<string, string> = {};
    let inFrontmatter = false;
    let bodyStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "---") {
        if (inFrontmatter) {
          bodyStart = i + 1;
          break;
        }
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter && line.includes(":")) {
        const [key, ...valueParts] = line.split(":");
        frontmatter[key.trim()] = valueParts.join(":").trim();
      }
    }

    if (frontmatter.name) name = frontmatter.name;
    if (frontmatter.description) description = frontmatter.description;

    const body = lines.slice(bodyStart).join("\n").trim();

    return {
      name,
      description: description || body.split("\n")[0] || "",
      model: frontmatter.model,
      tools: frontmatter.tools
        ? frontmatter.tools.split(",").map((t) => t.trim())
        : undefined,
      body: body || `You are a ${name} agent.`,
    };
  }

  private normalizeKey(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "-");
  }

  setMode(mode: AgentMode): void {
    this.activeMode = mode;
  }

  getMode(): AgentMode {
    return this.activeMode;
  }

  getProfile(name: string): AgentProfile | undefined {
    return this.profiles.get(this.normalizeKey(name));
  }

  getProfiles(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  setSystemAgent(name: string): void {
    const profile = this.getProfile(name);
    if (profile) {
      this.systemAgent = profile;
    }
  }

  getSystemAgent(): AgentProfile | null {
    return this.systemAgent;
  }

  getSessionFile(agentName: string): string {
    return join(this._sessionDir, `${this.normalizeKey(agentName)}.json`);
  }

  hasSession(agentName: string): boolean {
    return existsSync(this.getSessionFile(agentName));
  }

  setTeamMembers(members: string[]): void {
    this.teamMembers = members;
  }

  getTeamMembers(): string[] {
    return this.teamMembers;
  }

  setTeamState(name: string, prompt: string): void {
    const key = this.normalizeKey(name);
    this.teamStates.set(key, {
      name,
      prompt,
      status: "idle",
      task: "",
      output: "",
      elapsed: 0,
      runCount: 0,
      sessionFile: this.getSessionFile(name),
      toolCount: 0,
      lastWork: "",
      contextPct: 0,
    });
  }

  getTeamState(agentName: string): TeamState | undefined {
    return this.teamStates.get(this.normalizeKey(agentName));
  }

  updateTeamState(agentName: string, updates: Partial<TeamState>): void {
    const key = this.normalizeKey(agentName);
    const current = this.teamStates.get(key);
    if (current) {
      this.teamStates.set(key, { ...current, ...updates });
    }
  }

  setChainSteps(steps: ChainStep[]): void {
    this.chainSteps = steps;
    this.chainStepStates = steps.map((step) => ({
      agent: step.agent,
      status: "pending" as const,
      elapsed: 0,
      output: "",
      toolCount: 0,
      lastWork: "",
      contextPct: 0,
    }));
  }

  getChainSteps(): ChainStep[] {
    return this.chainSteps;
  }

  getChainStepStates(): ChainStepState[] {
    return this.chainStepStates;
  }

  updateChainStepState(index: number, updates: Partial<ChainStepState>): void {
    if (this.chainStepStates[index]) {
      this.chainStepStates[index] = { ...this.chainStepStates[index], ...updates };
    }
  }

  createSwarmAgent(task: string): SwarmState {
    const id = this.nextSwarmId++;
    const sessionFile = join(this._sessionDir, `swarm-${id}.json`);
    const agent: SwarmState = {
      id,
      status: "pending",
      task,
      output: "",
      elapsed: 0,
      turnCount: 1,
      sessionFile,
      toolCount: 0,
      lastWork: "",
      contextPct: 0,
    };
    this.swarmAgents.set(id, agent);
    return agent;
  }

  getSwarmAgent(id: number): SwarmState | undefined {
    return this.swarmAgents.get(id);
  }

  updateSwarmAgent(id: number, updates: Partial<SwarmState>): void {
    const current = this.swarmAgents.get(id);
    if (current) {
      this.swarmAgents.set(id, { ...current, ...updates });
    }
  }

  removeSwarmAgent(id: number): void {
    const agent = this.swarmAgents.get(id);
    if (agent?.proc) {
      agent.proc.kill();
    }
    this.swarmAgents.delete(id);
  }

  getSwarmAgents(): Map<number, SwarmState> {
    return this.swarmAgents;
  }

  async spawnAgent(options: SpawnOptions): Promise<AgentExecutionResult> {
    const agentProfile = this.getProfile(options.agentName);
    if (!agentProfile) {
      throw new Error(`Profile not found: ${options.agentName}`);
    }

    const model =
      agentProfile.model ||
      this.systemAgent?.model ||
      "openrouter/google/gemini-3-flash-preview";
    const tools =
      agentProfile.tools?.join(",") ||
      "read,bash,grep,find,ls,edit";

    const sessionFile = options.sessionKey
      ? join(this._sessionDir, `${options.sessionKey}.json`)
      : this.getSessionFile(options.agentName);

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
      "--session",
      sessionFile,
      "--append-system-prompt",
      agentProfile.body,
    ];

    if (hasSession || options.continueSession) {
      args.push("-c");
    }

    args.push(options.task);

    const startTime = Date.now();
    const textChunks: string[] = [];
    let toolCount = 0;
    let contextPct = 0;

    if (options.onStatusChange) {
      options.onStatusChange("running");
    }

    return new Promise((resolve) => {
      const proc = spawn("pi", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let output = "";
      let errorOutput = "";

      proc.stdout?.setEncoding("utf-8");
      proc.stdout?.on("data", (data) => {
        output += data.toString();
        textChunks.push(data.toString());

        if (options.onLastWorkUpdate) {
          const lines = output.split("\n").filter((l: string) => l.trim());
          const lastLine = lines[lines.length - 1] || "";
          try {
            const event = JSON.parse(lastLine);
            if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
              const full = textChunks.join("");
              const lastFullLine = full.split("\n").filter((l: string) => l.trim()).pop() || "";
              options.onLastWorkUpdate!(lastFullLine);
            }
            if (event.type === "tool_execution_start") {
              toolCount++;
            }
            if (event.type === "message_end" && event.message?.usage) {
              const inputTokens = event.message.usage.input || 0;
              const maxContext = 128000;
              contextPct = Math.round((inputTokens / maxContext) * 100);
            }
          } catch {}
        }
      });

      proc.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      const timeout = options.timeout || 300000;
      const timer = setTimeout(() => {
        proc.kill();
        if (options.onStatusChange) {
          options.onStatusChange("error");
        }
        resolve({
          output: "Timeout: Agent exceeded maximum runtime",
          exitCode: 1,
          elapsed: timeout,
          toolCount,
          contextPct,
        });
      }, timeout);

      const elapsedTimer = options.onElapsedUpdate ? setInterval(() => {
        options.onElapsedUpdate!(Date.now() - startTime);
      }, 1000) : undefined;

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (elapsedTimer) clearInterval(elapsedTimer);
        if (options.onStatusChange) {
          options.onStatusChange(code === 0 ? "done" : "error");
        }
        resolve({
          output: output || errorOutput,
          exitCode: code || 0,
          elapsed: Date.now() - startTime,
          toolCount,
          contextPct,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (elapsedTimer) clearInterval(elapsedTimer);
        if (options.onStatusChange) {
          options.onStatusChange("error");
        }
        resolve({
          output: `Error: ${err.message}`,
          exitCode: 1,
          elapsed: Date.now() - startTime,
          toolCount,
          contextPct,
        });
      });
    });
  }

  getSystemPrompt(basePrompt: string): { systemPrompt: string } {
    if (!this.systemAgent) {
      return { systemPrompt: basePrompt };
    }

    const descriptionLine = this.systemAgent.description
      ? `Description: ${this.systemAgent.description}\n\n`
      : "";

    return {
      systemPrompt:
        `${basePrompt}\n\n## Active Session Agent Profile\n\n` +
        `The following profile is active for this session. ` +
        `Follow it unless it conflicts with higher-priority runtime, safety, or tool instructions.\n\n` +
        `Profile name: ${this.systemAgent.name}\n` +
        descriptionLine +
        this.systemAgent.body,
    };
  }

  renderCard(state: TeamState, colWidth: number, theme: any): string[] {
    const w = colWidth - 2;
    const truncate = (s: string, max: number) =>
      s.length > max ? s.slice(0, max - 3) + "..." : s;

    const statusColor =
      state.status === "idle" ? "dim" :
      state.status === "running" ? "accent" :
      state.status === "done" ? "success" : "error";

    const statusIcon =
      state.status === "idle" ? "○" :
      state.status === "running" ? "●" :
      state.status === "done" ? "✓" : "✗";

    const nameStr = truncate(state.name, w);
    const nameVisible = nameStr.length;

    const statusStr = `${statusIcon} ${state.status}`;
    const timeStr = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
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
      border(" " + theme.fg("accent", truncate(state.name, w)), 1 + nameVisible),
      border(" " + statusLine, 1 + statusVisible),
      border(" " + statsLine, 1 + statsVisible),
      border(" " + workLine, 1 + workVisible),
      theme.fg("dim", bot),
    ];
  }

  renderGrid(states: TeamState[], width: number, theme: any, cols: number = 2): string[] {
    if (states.length === 0) return [theme.fg("dim", "No agents to display")];

    const gap = 1;
    const colWidth = Math.floor((width - gap * (cols - 1)) / cols);

    const rows: string[][] = [];
    for (let i = 0; i < states.length; i += cols) {
      const rowStates = states.slice(i, i + cols);
      const cards = rowStates.map(s => this.renderCard(s, colWidth, theme));

      while (cards.length < cols) {
        cards.push(Array(5).fill(" ".repeat(colWidth)));
      }

      const cardHeight = cards[0].length;
      for (let line = 0; line < cardHeight; line++) {
        rows.push(cards.map(card => card[line] || ""));
      }
    }

    return rows.map(cols => cols.join(" ".repeat(gap)));
  }

  registerTeamWidget(ctx: any): void {
    const agent = this;
    if (!this.teamWidgetText) {
      this.teamWidgetText = new Text("", 0, 1);
    }
    const text = this.teamWidgetText;
    ctx.ui.setWidget("agent-team", (_tui: any, theme: any) => {
      return {
        render(width: number): string[] {
          const states = Array.from(agent.teamStates.values());
          if (states.length === 0) {
            text.setText(theme.fg("dim", "No team members"));
            return text.render(width);
          }
          const cols = states.length <= 3 ? states.length : states.length === 4 ? 2 : 3;
          const output = agent.renderGrid(states, width, theme, cols);
          text.setText(output.join("\n"));
          return text.render(width);
        },
        invalidate() { text.invalidate(); }
      };
    });
  }

  registerChainWidget(ctx: any): void {
    const agent = this;
    if (!this.chainWidgetText) {
      this.chainWidgetText = new Text("", 0, 1);
    }
    const text = this.chainWidgetText;
    ctx.ui.setWidget("agent-chain", (_tui: any, theme: any) => {
      return {
        render(width: number): string[] {
          const states = agent.getChainStepStates();
          if (states.length === 0) {
            text.setText(theme.fg("dim", "No chain configured"));
            return text.render(width);
          }

          const arrowWidth = 5;
          const cols = states.length;
          const totalArrowWidth = arrowWidth * (cols - 1);
          const colWidth = Math.max(12, Math.floor((width - totalArrowWidth) / cols));

          const cards = states.map(s => agent.renderCard({
            name: s.agent,
            prompt: "",
            status: s.status as any,
            task: "",
            output: s.output,
            elapsed: s.elapsed,
            runCount: 0,
            sessionFile: "",
            toolCount: s.toolCount,
            lastWork: s.lastWork,
            contextPct: s.contextPct
          }, colWidth, theme));

          const cardHeight = cards[0].length;
          const arrowRow = 2;
          const outputLines: string[] = [];

          for (let line = 0; line < cardHeight; line++) {
            let row = cards[0][line];
            for (let c = 1; c < cols; c++) {
              if (line === arrowRow) {
                row += theme.fg("dim", " ──▶ ");
              } else {
                row += " ".repeat(arrowWidth);
              }
              row += cards[c][line];
            }
            outputLines.push(row);
          }

          text.setText(outputLines.join("\n"));
          return text.render(width);
        },
        invalidate() { text.invalidate(); }
      };
    });
  }

  registerSwarmWidget(ctx: any): void {
    const agent = this;
    ctx.ui.setWidget("agent-swarm", (_tui: any, theme: any) => {
      const text = new Text("", 0, 1);
      return {
        render(width: number): string[] {
          const swarmAgents = Array.from(agent.getSwarmAgents().values());
          if (swarmAgents.length === 0) {
            text.setText(theme.fg("dim", "No swarm agents"));
            return text.render(width);
          }

          const cols = swarmAgents.length <= 3 ? swarmAgents.length : swarmAgents.length === 4 ? 2 : 3;
          const gap = 1;
          const colWidth = Math.floor((width - gap * (cols - 1)) / cols);

          const rows: string[] = [];
          for (let i = 0; i < swarmAgents.length; i += cols) {
            const rowAgents = swarmAgents.slice(i, i + cols);
            const cards = rowAgents.map(a => agent.renderCard({
              name: `[${a.id}] ${a.task.slice(0, 20)}`,
              prompt: "",
              status: a.status as any,
              task: a.task,
              output: a.output,
              elapsed: a.elapsed,
              runCount: a.turnCount,
              sessionFile: "",
              toolCount: a.toolCount,
              lastWork: a.lastWork,
              contextPct: a.contextPct
            }, colWidth, theme));

            while (cards.length < cols) {
              cards.push(Array(6).fill(" ".repeat(colWidth)));
            }

            const cardHeight = cards[0].length;
            for (let line = 0; line < cardHeight; line++) {
              const rowLine = cards.map(card => card[line] || "").join(" ".repeat(gap));
              rows.push(rowLine);
            }
          }

          text.setText(rows.join("\n"));
          return text.render(width);
        },
        invalidate() { text.invalidate(); }
      };
    });
  }

  clearWidgets(ctx: any): void {
    ctx.ui.setWidget("agent-team", undefined);
    ctx.ui.setWidget("agent-chain", undefined);
    ctx.ui.setWidget("agent-swarm", undefined);
  }

  registerAvailableAgentsTool(): void {
    this.pi.registerTool({
      name: "available_agents",
      description: "List all available specialist agents",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        const profiles = this.getProfiles();
        if (profiles.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No agents available. Create profiles in .pi/agents/",
              },
            ],
          };
        }
        const list = profiles
          .map((p) => `- ${p.name}: ${p.description || "No description"}`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Available agents:\n${list}` }],
        };
      },
    });
  }
}
