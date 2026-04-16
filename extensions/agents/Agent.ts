import { ChildProcess, spawn } from "node:child_process";
import { getAgentDir, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";

export type AgentMode = "single" | "team" | "chain" | "swarm";

export interface AgentProfile {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  default?: boolean;
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
  rolePrompt?: string;
}

export interface ChainStep {
  agent: string;
  prompt: string;
  rolePrompt?: string;
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

interface DelegationResult {
  agentName: string;
  task: string;
  status: "delegating" | "done" | "error";
  elapsed: number;
  exitCode: number;
  fullOutput: string;
  reason?: string;
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
  private delegationAllowed = process.env.PI_NO_DELEGATION !== "1";

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.registerToolsTools();
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
      const defaultProfile = Array.from(this.profiles.values()).find(p => p.default);
      if (defaultProfile) {
        this.systemAgent = defaultProfile;
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
      default: frontmatter.default === "true",
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
      this.chainStepStates[index] = {
        ...this.chainStepStates[index],
        ...updates,
      };
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
      agentProfile.tools?.join(",") || "read,bash,grep,find,ls,edit";

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
            if (
              event.type === "message_update" &&
              event.assistantMessageEvent?.type === "text_delta"
            ) {
              const full = textChunks.join("");
              const lastFullLine =
                full
                  .split("\n")
                  .filter((l: string) => l.trim())
                  .pop() || "";
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

      const elapsedTimer = options.onElapsedUpdate
        ? setInterval(() => {
            options.onElapsedUpdate!(Date.now() - startTime);
          }, 1000)
        : undefined;

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

  private delegateAgent(
    agentName: string,
    task: string,
    ctx: any,
  ): Promise<{ output: string; exitCode: number; elapsed: number }> {
    const profiles = this.getProfiles();
    const profile = profiles.find(
      (p) =>
        p.name.toLowerCase() === agentName.toLowerCase() ||
        p.name.toLowerCase().replace(/\s+/g, "-") ===
          agentName.toLowerCase().replace(/\s+/g, "-"),
    );

    if (!profile) {
      return Promise.resolve({
        output: `Agent "${agentName}" not found. Use agent_list to see available agents.`,
        exitCode: 1,
        elapsed: 0,
      });
    }

    const model = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "openrouter/google/gemini-3-flash-preview";

    const tools = profile.tools?.join(",") || "read,bash,grep,find,ls,edit";
    const sessionFile = join(
      this._sessionDir,
      `delegate-${agentName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.json`,
    );

    const args = [
      "--mode",
      "json",
      "-p",
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

    args.push(task);

    const startTime = Date.now();
    const textChunks: string[] = [];

    return new Promise((resolve) => {
      const proc = spawn("pi", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_NO_DELEGATION: "1" },
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

        const elapsed = Date.now() - startTime;
        const exitCode = code ?? 1;
        const full = textChunks.join("");

        ctx.ui.notify(
          `Delegated to ${agentName} ${exitCode === 0 ? "done" : "error"} in ${Math.round(elapsed / 1000)}s`,
          exitCode === 0 ? "info" : "error",
        );

        resolve({
          output: full,
          exitCode,
          elapsed,
        });

        try {
          if (existsSync(sessionFile)) {
            unlinkSync(sessionFile);
          }
        } catch {}
      });

      proc.on("error", (err) => {
        resolve({
          output: `Error spawning agent: ${err.message}`,
          exitCode: 1,
          elapsed: Date.now() - startTime,
        });
      });
    });
  }

  getSystemPrompt(basePrompt: string): { systemPrompt: string } {
    const toolsDiscoverySection = `## Tool Discovery

When you need to find the right tool for a task, use these tools:

1. **tools_list** - List all available tools
   - Use with filter to narrow down by name: \`tools_list({ filter: "agent" })\`
   - Use with scope to filter by source: \`tools_list({ scope: "user" })\`
   - Use with active to see enabled tools: \`tools_list({ active: true })\`

2. **tools_search** - Search tools with relevance ranking
   - Best for finding tools when you know the concept: \`tools_search({ query: "delegate" })\`
   - Filter by category: \`tools_search({ query: "agent", category: "team_" })\`
   - Returns scored results sorted by match quality

3. **tools_info** - Get detailed information about a specific tool
   - Use after finding a tool name: \`tools_info({ name: "agent_delegate" })\`
   - Include schema: \`tools_info({ name: "agent_delegate", includeSchema: true })\`

## Finding Tools for Tasks

When unsure which tool to use:
1. First, use \`tools_search\` with a relevant query
2. Review the results and scores
3. Use \`tools_info\` on promising candidates
4. Check parameters with \`tools_info(..., { includeSchema: true })\`

Example workflow to find a delegation tool:
\`\`\`
1. tools_search({ query: "delegate" })
2. tools_info({ name: "agent_delegate", includeSchema: true })
\`\`\`

`;

    if (!this.systemAgent) {
      return { systemPrompt: basePrompt + "\n\n" + toolsDiscoverySection };
    }

    const descriptionLine = this.systemAgent.description
      ? `Description: ${this.systemAgent.description}\n\n`
      : "";

    return {
      systemPrompt:
        `${basePrompt}\n\n${toolsDiscoverySection}\n\n## Active Session Agent Profile\n\n` +
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
      state.status === "idle"
        ? "dim"
        : state.status === "running"
          ? "accent"
          : state.status === "done"
            ? "success"
            : "error";

    const statusIcon =
      state.status === "idle"
        ? "○"
        : state.status === "running"
          ? "●"
          : state.status === "done"
            ? "✓"
            : "✗";

    const nameStr = truncate(state.name, w);
    const nameVisible = nameStr.length;

    const statusStr = `${statusIcon} ${state.status}`;
    const timeStr =
      state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
    const statusLine = theme.fg(statusColor, statusStr + timeStr);
    const statusVisible = statusStr.length + timeStr.length;

    const toolStr = state.toolCount > 0 ? `${state.toolCount}` : "";
    const ctxStr =
      state.contextPct > 0 ? `${Math.round(state.contextPct)}%` : "";
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
      border(
        " " + theme.fg("accent", truncate(state.name, w)),
        1 + nameVisible,
      ),
      border(" " + statusLine, 1 + statusVisible),
      border(" " + statsLine, 1 + statsVisible),
      border(" " + workLine, 1 + workVisible),
      theme.fg("dim", bot),
    ];
  }

  renderGrid(
    states: TeamState[],
    width: number,
    theme: any,
    cols: number = 2,
  ): string[] {
    if (states.length === 0) return [theme.fg("dim", "No agents to display")];

    const gap = 1;
    const colWidth = Math.floor((width - gap * (cols - 1)) / cols);

    const rows: string[][] = [];
    for (let i = 0; i < states.length; i += cols) {
      const rowStates = states.slice(i, i + cols);
      const cards = rowStates.map((s) => this.renderCard(s, colWidth, theme));

      while (cards.length < cols) {
        cards.push(Array(5).fill(" ".repeat(colWidth)));
      }

      const cardHeight = cards[0].length;
      for (let line = 0; line < cardHeight; line++) {
        rows.push(cards.map((card) => card[line] || ""));
      }
    }

    return rows.map((cols) => cols.join(" ".repeat(gap)));
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
          const cols =
            states.length <= 3 ? states.length : states.length === 4 ? 2 : 3;
          const output = agent.renderGrid(states, width, theme, cols);
          text.setText(output.join("\n"));
          return text.render(width);
        },
        invalidate() {
          text.invalidate();
        },
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
          const colWidth = Math.max(
            12,
            Math.floor((width - totalArrowWidth) / cols),
          );

          const cards = states.map((s) =>
            agent.renderCard(
              {
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
                contextPct: s.contextPct,
              },
              colWidth,
              theme,
            ),
          );

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
        invalidate() {
          text.invalidate();
        },
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

          const cols =
            swarmAgents.length <= 3
              ? swarmAgents.length
              : swarmAgents.length === 4
                ? 2
                : 3;
          const gap = 1;
          const colWidth = Math.floor((width - gap * (cols - 1)) / cols);

          const rows: string[] = [];
          for (let i = 0; i < swarmAgents.length; i += cols) {
            const rowAgents = swarmAgents.slice(i, i + cols);
            const cards = rowAgents.map((a) =>
              agent.renderCard(
                {
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
                  contextPct: a.contextPct,
                },
                colWidth,
                theme,
              ),
            );

            while (cards.length < cols) {
              cards.push(Array(6).fill(" ".repeat(colWidth)));
            }

            const cardHeight = cards[0].length;
            for (let line = 0; line < cardHeight; line++) {
              const rowLine = cards
                .map((card) => card[line] || "")
                .join(" ".repeat(gap));
              rows.push(rowLine);
            }
          }

          text.setText(rows.join("\n"));
          return text.render(width);
        },
        invalidate() {
          text.invalidate();
        },
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
      name: "agent_list",
      label: "List Agents",
      description:
        "List all available specialist agents. Shows agent names and their descriptions.",
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
            details: undefined,
          };
        }
        const list = profiles
          .map((p) => `- ${p.name}: ${p.description || "No description"}`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Available agents:\n${list}` }],
          details: undefined,
        };
      },
    });

    this.pi.registerTool({
      name: "agent_delegate",
      label: "Delegate to Agent",
      description:
        "Delegate a task to a specialized agent.\n" +
        "- Sequential execution: waits for completion before continuing\n" +
        "- No re-delegation: the delegated agent cannot delegate further\n" +
        "- Use when task requires expertise different from current agent\n\n" +
        "Parameters:\n" +
        "- agent: Target agent name (use agent_list to find available agents)\n" +
        "- task: The task to delegate",
      parameters: Type.Object({
        agent: Type.String({
          description: "Target agent name (e.g., 'Researcher', 'Coder')",
        }),
        task: Type.String({
          description: "Task description for the delegated agent",
        }),
      }),

      execute: async (_toolCallId, params, _signal, onUpdate, ctx) => {
        if (!this.delegationAllowed) {
          return {
            content: [
              {
                type: "text",
                text: "Delegation not allowed. This agent received the task via delegation and cannot delegate further.",
              },
            ],
            details: {
              status: "error",
              reason: "delegation_not_allowed",
            } as DelegationResult,
          };
        }

        const { agent, task } = params as { agent: string; task: string };

        if (onUpdate) {
          onUpdate({
            content: [{ type: "text", text: `Delegating to ${agent}...` }],
            details: {
              agentName: agent,
              task,
              status: "delegating",
              elapsed: 0,
              exitCode: 0,
              fullOutput: "",
            } as DelegationResult,
          });
        }

        const result = await this.delegateAgent(agent, task, ctx);

        const truncated =
          result.output.length > 8000
            ? result.output.slice(0, 8000) + "\n\n... [truncated]"
            : result.output;

        const status = result.exitCode === 0 ? "done" : "error";
        const summary = `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

        return {
          content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
          details: {
            agentName: agent,
            task,
            status,
            elapsed: result.elapsed,
            exitCode: result.exitCode,
            fullOutput: result.output,
          } as DelegationResult,
        };
      },

      renderCall(args, theme) {
        const agentName = (args as any).agent || "?";
        const task = (args as any).task || "";
        const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
        return new Text(
          theme.fg("toolTitle", theme.bold("agent_delegate ")) +
            theme.fg("accent", agentName) +
            theme.fg("dim", " — ") +
            theme.fg("muted", preview),
          0,
          0,
        );
      },

      renderResult(result, options, theme) {
        const details = result.details as DelegationResult | undefined;
        if (!details || details.reason === "delegation_not_allowed") {
          const text = result.content[0];
          return new Text(text?.type === "text" ? text.text : "", 0, 0);
        }

        if (options.isPartial || details.status === "delegating") {
          return new Text(
            theme.fg("accent", `→ ${details.agentName || "?"}`) +
              theme.fg("dim", " delegating..."),
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

        const sep = theme.fg("dim", "─".repeat(50));
        const header =
          theme.fg("accent", sep) +
          "\n" +
          theme.fg(color, `→ ${details.agentName} `) +
          theme.fg("dim", `${elapsed}s`);

        if (options.expanded) {
          const taskText = details.task || "(no task)";
          const output = details.fullOutput || "(no output)";
          const truncated =
            output.length > 6000
              ? output.slice(0, 6000) + "\n... [truncated]"
              : output;

          return new Text(
            header +
              "\n\n" +
              theme.fg("accent", "Task: ") +
              theme.fg("text", taskText) +
              "\n\n" +
              theme.fg("accent", "Result:") +
              "\n" +
              theme.fg("muted", truncated) +
              "\n" +
              theme.fg(
                "dim",
                "─────────────────────────────────────────────────",
              ),
            0,
            0,
          );
        }

        const preview = details.fullOutput
          ? details.fullOutput.slice(0, 150) +
            (details.fullOutput.length > 150 ? "..." : "")
          : "(no output)";
        return new Text(
          theme.fg(color, `→ ${details.agentName} `) +
            theme.fg("dim", `${elapsed}s`) +
            theme.fg("muted", `\n→ ${preview}`),
          0,
          0,
        );
      },
    });
  }

  private registerToolsTools(): void {
    this.pi.registerTool({
      name: "tools_list",
      label: "List Tools",
      description:
        "List all available tools with optional filtering.\n\n" +
        "Use this tool to discover what tools are available in the current session.\n\n" +
        "Parameters:\n" +
        "- filter: Optional name filter (case-insensitive)\n" +
        "- scope: Filter by source (all, user, project, builtin)\n" +
        "- active: Show only currently active tools",
      parameters: Type.Object({
        filter: Type.Optional(
          Type.String({
            description:
              "Filter tools by name (case-insensitive substring match)",
          }),
        ),
        scope: Type.Optional(
          Type.Union(
            [
              Type.Literal("all"),
              Type.Literal("user"),
              Type.Literal("project"),
              Type.Literal("builtin"),
            ],
            { description: "Filter by tool source scope" },
          ),
        ),
        active: Type.Optional(
          Type.Boolean({
            description: "Only show active (enabled) tools",
          }),
        ),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const allTools = this.pi.getAllTools();
        const activeTools = new Set(this.pi.getActiveTools());

        let tools = allTools;

        if (params.filter) {
          const filter = params.filter.toLowerCase();
          tools = tools.filter((t) => t.name.toLowerCase().includes(filter));
        }

        if (params.scope && params.scope !== "all") {
          tools = tools.filter((t) => t.sourceInfo?.scope === params.scope);
        }

        if (params.active) {
          tools = tools.filter((t) => activeTools.has(t.name));
        }

        if (tools.length === 0) {
          return {
            content: [
              { type: "text", text: "No tools found matching your criteria." },
            ],
            details: { count: 0, tools: [] },
          };
        }

        const lines: string[] = [];
        lines.push(`Available Tools (${tools.length}):`);
        lines.push("");

        for (const tool of tools) {
          const active = activeTools.has(tool.name)
            ? " [active]"
            : " [disabled]";
          const source = tool.sourceInfo?.source || "unknown";
          lines.push(`- ${tool.name}${active}`);
          lines.push(`  ${tool.description.split("\n")[0]}`);
          lines.push(`  Source: ${source}`);
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            count: tools.length,
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              source: t.sourceInfo?.source,
              scope: t.sourceInfo?.scope,
              isActive: activeTools.has(t.name),
            })),
          },
        };
      },

      renderCall(args, theme) {
        const filter = (args as any).filter;
        const preview = filter ? ` filter: "${filter}"` : "";
        return new Text(
          theme.fg("toolTitle", theme.bold("tools_list")) +
            theme.fg("dim", " — ") +
            theme.fg("muted", `list tools${preview}`),
          0,
          0,
        );
      },

      renderResult(result, options, theme) {
        const details = result.details as any;
        const count = details?.count || 0;
        const firstContent = result.content?.[0] as any;
        const filter =
          firstContent?.text?.match(/filter: "(.*?)"/)?.[1] || undefined;

        if (!options.expanded) {
          const filterText = filter ? ` filter: "${filter}"` : "";
          const activeCount =
            details?.tools?.filter((t: any) => t.isActive).length || 0;
          const badge =
            count > 0
              ? ` (${count}${activeCount < count ? "/" + activeCount : ""})`
              : "";

          return new Text(
            theme.fg("toolTitle", "🛠 tools_list") +
              theme.fg("accent", badge) +
              theme.fg("muted", filterText),
            0,
            0,
          );
        }

        if (count === 0) {
          return new Text(
            theme.fg("dim", "No tools found matching your criteria."),
            0,
            0,
          );
        }

        const lines: string[] = [];
        lines.push(theme.fg("accent", "─".repeat(50)));
        lines.push(
          theme.fg("accent", "📋 Tools List") +
            theme.fg("dim", ` (${count} tools)`),
        );
        lines.push(theme.fg("accent", "─".repeat(50)));

        for (const tool of details.tools) {
          const status = tool.isActive
            ? theme.fg("success", "●")
            : theme.fg("dim", "○");
          lines.push(status + " " + theme.fg("text", tool.name));
          const desc = (tool.description || "").split("\n")[0];
          const truncatedDesc =
            desc.length > 55 ? desc.slice(0, 52) + "..." : desc;
          lines.push("  " + theme.fg("muted", truncatedDesc));
        }

        lines.push(theme.fg("accent", "═".repeat(50)));

        return new Text(lines.join("\n"), 0, 0);
      },
    });

    this.pi.registerTool({
      name: "tools_search",
      label: "Search Tools",
      description:
        "Search tools by name or description with relevance ranking.\n\n" +
        "Returns ranked results sorted by match quality:\n" +
        "- Exact name match: highest priority\n" +
        "- Name starts with query: high priority\n" +
        "- Name contains query: medium priority\n" +
        "- Description contains query: lower priority\n\n" +
        "Parameters:\n" +
        "- query: Search term (required)\n" +
        "- category: Filter by name prefix (e.g., 'agent_', 'team_')\n" +
        "- limit: Maximum results (default: 10)",
      parameters: Type.Object({
        query: Type.String({
          description: "Search query (matches name or description)",
        }),
        category: Type.Optional(
          Type.String({
            description:
              "Filter by tool name prefix (e.g., 'agent_', 'team_', 'chain_', 'tools_')",
          }),
        ),
        limit: Type.Optional(
          Type.Number({
            description: "Maximum results to return",
            default: 10,
          }),
        ),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const allTools = this.pi.getAllTools();
        const activeTools = new Set(this.pi.getActiveTools());

        const query = params.query.toLowerCase();
        const limit = params.limit || 10;
        const category = params.category?.toLowerCase();

        const scored = allTools.map((tool) => {
          let score = 0;
          const name = tool.name.toLowerCase();
          const desc = tool.description.toLowerCase();

          if (name === query) {
            score = 100;
          } else if (name.startsWith(query)) {
            score = 80;
          } else if (name.includes(query)) {
            score = 60;
          } else if (desc.includes(query)) {
            score = 40;
          }

          if (category && !name.startsWith(category)) {
            score = 0;
          }

          return { tool, score };
        });

        const results = scored
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No tools found matching "${params.query}".`,
              },
            ],
            details: { count: 0, query: params.query, tools: [] },
          };
        }

        const lines: string[] = [];
        lines.push(
          `Search Results for "${params.query}" (${results.length} matches):`,
        );
        lines.push("");

        for (let i = 0; i < results.length; i++) {
          const { tool, score } = results[i];
          const active = activeTools.has(tool.name) ? " [active]" : "";
          lines.push(`${i + 1}. [${tool.name}] (${score} pts)${active}`);
          lines.push(`   ${tool.description.split("\n")[0]}`);
        }

        lines.push("");
        lines.push(
          `Tip: Use tools_info for detailed information about a specific tool.`,
        );

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            count: results.length,
            query: params.query,
            tools: results.map((r) => ({
              name: r.tool.name,
              description: r.tool.description,
              score: r.score,
              isActive: activeTools.has(r.tool.name),
            })),
          },
        };
      },

      renderCall(args, theme) {
        const query = (args as any).query || "";
        const preview = query.length > 30 ? query.slice(0, 27) + "..." : query;
        return new Text(
          theme.fg("toolTitle", theme.bold("tools_search")) +
            theme.fg("dim", " — ") +
            theme.fg("accent", `"${preview}"`),
          0,
          0,
        );
      },

      renderResult(result, options, theme) {
        const details = result.details as any;
        const count = details?.count || 0;
        const query = details?.query || "";

        if (!options.expanded) {
          const preview =
            query.length > 20 ? query.slice(0, 17) + "..." : query;
          const badge = count > 0 ? ` (${count})` : "";

          return new Text(
            theme.fg("toolTitle", "🔍 tools_search") +
              theme.fg("accent", badge) +
              theme.fg("dim", ` "${preview}"`),
            0,
            0,
          );
        }

        if (count === 0) {
          return new Text(
            theme.fg("dim", `No tools found matching "${query}".`),
            0,
            0,
          );
        }

        const lines: string[] = [];
        lines.push(theme.fg("accent", "─".repeat(50)));
        lines.push(
          theme.fg("accent", "🔍 Search Results") +
            theme.fg("dim", ` for "${query}" (${count} matches)`),
        );
        lines.push(theme.fg("accent", "─".repeat(50)));

        for (let i = 0; i < details.tools.length; i++) {
          const tool = details.tools[i];
          const num = (i + 1).toString().padStart(2, " ");
          const active = tool.isActive
            ? theme.fg("success", "●")
            : theme.fg("dim", "○");
          lines.push(
            theme.fg("dim", num + ".") +
              " " +
              active +
              " " +
              theme.fg("text", tool.name) +
              theme.fg("muted", ` (${tool.score}pts)`),
          );
          const desc = (tool.description || "").split("\n")[0];
          const truncatedDesc =
            desc.length > 50 ? desc.slice(0, 47) + "..." : desc;
          lines.push("     " + theme.fg("muted", truncatedDesc));
        }

        lines.push(theme.fg("accent", "═".repeat(50)));
        lines.push(
          theme.fg("dim", "Tip: Use tools_info for detailed information."),
        );

        return new Text(lines.join("\n"), 0, 0);
      },
    });

    this.pi.registerTool({
      name: "tools_info",
      label: "Tool Info",
      description:
        "Get detailed information about a specific tool.\n\n" +
        "Use this to learn how a tool works, what parameters it accepts,\n" +
        "and where it comes from.\n\n" +
        "Parameters:\n" +
        "- name: Exact tool name (required)\n" +
        "- includeSchema: Include parameter schema in output",
      parameters: Type.Object({
        name: Type.String({
          description: "Exact tool name to look up",
        }),
        includeSchema: Type.Optional(
          Type.Boolean({
            description: "Include parameter schema in output",
            default: false,
          }),
        ),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const allTools = this.pi.getAllTools();
        const activeTools = new Set(this.pi.getActiveTools());

        const tool = allTools.find((t) => t.name === params.name);

        if (!tool) {
          const similar = allTools
            .filter((t) =>
              t.name.toLowerCase().includes(params.name.toLowerCase()),
            )
            .slice(0, 3)
            .map((t) => t.name);

          let message = `Tool "${params.name}" not found.`;
          if (similar.length > 0) {
            message += `\n\nDid you mean: ${similar.join(", ")}?`;
          }
          message += `\n\nUse tools_list or tools_search to find available tools.`;

          return {
            content: [{ type: "text", text: message }],
            details: { found: false, name: params.name },
          };
        }

        const isActive = activeTools.has(tool.name);
        const lines: string[] = [];

        lines.push("═".repeat(50));
        lines.push(`Tool: ${tool.name}`);
        lines.push("═".repeat(50));
        lines.push("");
        lines.push(`Active: ${isActive ? "Yes" : "No"}`);
        lines.push(`Source: ${tool.sourceInfo?.source || "unknown"}`);
        lines.push(`Scope: ${tool.sourceInfo?.scope || "unknown"}`);
        if (tool.sourceInfo?.path) {
          lines.push(`Path: ${tool.sourceInfo.path}`);
        }
        lines.push("");
        lines.push("Description:");
        lines.push(tool.description);
        lines.push("");

        if (params.includeSchema && tool.parameters) {
          lines.push("Parameters Schema:");
          try {
            const schemaStr = JSON.stringify(tool.parameters, null, 2);
            lines.push(schemaStr);
          } catch {
            lines.push("(Unable to display schema)");
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            found: true,
            name: tool.name,
            description: tool.description,
            source: tool.sourceInfo?.source,
            scope: tool.sourceInfo?.scope,
            path: tool.sourceInfo?.path,
            isActive,
            parameters: params.includeSchema ? tool.parameters : undefined,
          },
        };
      },

      renderCall(args, theme) {
        const name = (args as any).name || "?";
        const includeSchema = (args as any).includeSchema;
        const schemaNote = includeSchema ? " (with schema)" : "";
        return new Text(
          theme.fg("toolTitle", theme.bold("tools_info")) +
            theme.fg("dim", " — ") +
            theme.fg("accent", name) +
            theme.fg("muted", schemaNote),
          0,
          0,
        );
      },

      renderResult(result, options, theme) {
        const details = result.details as any;

        if (!details.found) {
          return new Text(
            theme.fg("error", "✗ ") +
              theme.fg("text", `Tool "${details.name}" not found`) +
              theme.fg("muted", " — use tools_search to find tools"),
            0,
            0,
          );
        }

        if (!options.expanded) {
          const status = details.isActive
            ? theme.fg("success", "●")
            : theme.fg("dim", "○");
          const desc = (details.description || "").split("\n")[0];
          const truncatedDesc =
            desc.length > 40 ? desc.slice(0, 37) + "..." : desc;

          return new Text(
            theme.fg("toolTitle", "📎 tools_info") +
              " " +
              status +
              " " +
              theme.fg("text", details.name) +
              theme.fg("muted", " — " + truncatedDesc),
            0,
            0,
          );
        }

        const lines: string[] = [];
        const status = details.isActive
          ? theme.fg("success", "Active")
          : theme.fg("dim", "Disabled");

        lines.push(theme.fg("accent", "─".repeat(50)));
        lines.push(
          theme.fg("accent", "📎 Tool Info: ") + theme.fg("text", details.name),
        );
        lines.push(theme.fg("accent", "─".repeat(50)));
        lines.push("");
        lines.push(
          status + "  " + theme.fg("muted", `(${details.source || "unknown"})`),
        );
        lines.push("");
        lines.push(theme.fg("accent", "Description:"));
        lines.push(theme.fg("text", details.description || "(no description)"));
        lines.push("");
        lines.push(theme.fg("accent", "Details:"));
        lines.push(
          theme.fg("dim", "  Source: ") +
            theme.fg("muted", details.source || "unknown"),
        );
        lines.push(
          theme.fg("dim", "  Scope: ") +
            theme.fg("muted", details.scope || "unknown"),
        );
        if (details.path) {
          lines.push(
            theme.fg("dim", "  Path: ") + theme.fg("muted", details.path),
          );
        }

        if (details.parameters) {
          lines.push("");
          lines.push(theme.fg("accent", "Parameters Schema:"));
          try {
            const schemaStr = JSON.stringify(details.parameters, null, 2);
            lines.push(theme.fg("muted", schemaStr));
          } catch {
            lines.push(theme.fg("dim", "(Unable to display schema)"));
          }
        }

        lines.push(theme.fg("accent", "═".repeat(50)));

        return new Text(lines.join("\n"), 0, 0);
      },
    });
  }
}
