# Agent Extension Implementation Plan

## Overview

Build a unified agent extension system with **4 modes** (only ONE active at a time):
- **Single** - Default mode, one agent (systemAgent)
- **Team** - Supervised dispatch (`/team`)
- **Chain** - Sequential workflow (`/chain`)
- **Swarm** - Parallel background agents (`/swarm`)

**Main Agent**: systemAgent (formerly activeProfile) is always the main agent coordinating all modes.

## File Structure

```
extensions/agents/
├── index.ts          # Entry point - instantiates Agent class
├── Agent.ts          # Core class - all state, profiles, spawner, mode management
├── System.ts        # systemAgent profile selection (/system)
├── Swarm.ts         # Parallel agents mode (/swarm + swarm_* tools)
├── Team.ts          # Team mode (/team + dispatch_agent)
└── Chain.ts         # Chain mode (/chain + run_chain)

---

## Module Responsibilities

### 1. index.ts

**Purpose**: Entry point that loads the Agent class

**Responsibilities**:
- Import and instantiate `new Agent(pi)`
- Register session_start event to initialize AgentState
- Set up footer widget with agent stats
- Inject system prompt from active profile

**Key Code**:
```typescript
import { Agent } from "./Agent";

export default function Agents(pi: ExtensionAPI): void {
  const agent = new Agent(pi);
  
  pi.on("session_start", async (_event, ctx) => {
    agent.initialize(ctx.cwd);
  });
  
  pi.on("before_agent_start", async (event, ctx) => {
    return agent.getSystemPrompt(event.systemPrompt);
  });
}
```

---

### 2. Agent.ts (Core)

**Purpose**: Central coordinator - all core functionality in one class

**Responsibilities**:
- **Mode Management** - Track active mode (single/team/chain/swarm), only one active at a time
- **State Management** - All state (profiles, teams, chains, swarm) in this class
- **Profile Loading** - Load profiles from `.pi/agents/`
- **Agent Spawning** - Unified spawn logic for all modes
- **systemAgent** - Main agent that coordinates all modes
- **Provide services to other modes** - System, Swarm, Team, Chain call Agent methods

**Mode Types**:
```typescript
type AgentMode = "single" | "team" | "chain" | "swarm";
```

**Internal State**:
```typescript
class Agent {
  private pi: ExtensionAPI;
  
  // ── Core State ──
  private _initialized = false;
  private _sessionDir = "";
  
  // ── Active Mode ──
  private activeMode: AgentMode = "single";
  
  // ── systemAgent (Main Agent) ──
  private profiles = new Map<string, AgentProfile>();
  private systemAgent: AgentProfile | null = null;
  
  // ── Sessions ──
  private sessions = new Map<string, string>();  // profileKey -> sessionFile
  
  // ── Team Mode State ──
  private teamMembers: string[] = [];
  private teamStates = new Map<string, TeamState>();
  
  // ── Chain Mode State ──
  private chainSteps: ChainStep[] = [];
  private chainStepStates: ChainStepState[] = [];
  
  // ── Swarm Mode State ──
  private swarmAgents = new Map<number, SwarmState>();
  private nextSwarmId = 1;
}
```

**Core Methods**:
- `initialize(cwd: string)` - Set up session directory, load profiles (user + project)
- `isInitialized(): boolean` - Check if Agent is ready
- `reloadProfiles(cwd: string)` - Reload profiles (called when workspace changes)
  
- `setMode(mode: AgentMode)` - Set active mode
- `getMode(): AgentMode` - Get current mode

- `loadProfiles(cwd: string): AgentProfile[]` - Load from `.pi/agents/`
- `getProfile(name: string): AgentProfile | undefined` - Get profile by name
- `getProfiles(): AgentProfile[]` - Get all profiles
- `setSystemAgent(name: string)` - Set systemAgent
- `getSystemAgent(): AgentProfile | null` - Get systemAgent

- `getSessionFile(agentName: string): string` - Get session file path
- `hasSession(agentName: string): boolean` - Check if session exists

- `setTeamMembers(members: string[])` - Set team members
- `getTeamMembers(): string[]` - Get team members
- `setTeamState(name: string, prompt: string)` - Set team member with prompt
- `getTeamState(agentName: string): TeamState | undefined` - Get team member state
- `updateTeamState(agentName: string, updates: Partial<TeamState>)` - Update team state

- `setChainSteps(steps: ChainStep[])` - Set chain steps
- `getChainSteps(): ChainStep[]` - Get chain steps
- `getChainStepStates(): ChainStepState[]` - Get chain step states

- `createSwarmAgent(task: string): SwarmState` - Create new swarm agent
- `getSwarmAgent(id: number): SwarmState | undefined` - Get swarm agent
- `updateSwarmAgent(id: number, updates: Partial<SwarmState>)` - Update swarm
- `removeSwarmAgent(id: number)` - Remove swarm agent
- `getSwarmAgents(): Map<number, SwarmState>` - Get all swarm agents

- `spawnAgent(options: SpawnOptions): Promise<AgentExecutionResult>` - **Unified spawn**

- `getSystemPrompt(basePrompt: string): { systemPrompt: string }` - Inject systemAgent

---

### Profile Loading (in Agent.ts)

**Two scopes**:
1. **Project scope** - Project-specific profiles from `cwd/.pi/agents/` (higher priority)
2. **User scope** - Global profiles from `getAgentDir()` (lower priority, can be overridden)

Project profiles override user profiles if same name.

```typescript
private loadProfiles(cwd: string): void {
  // 1. Load user profiles first (base profiles)
  try {
    const userDir = this.pi.getAgentDir?.();
    if (userDir && existsSync(userDir)) {
      for (const file of readdirSync(userDir)) {
        if (file.endsWith(".md")) {
          const content = readFileSync(join(userDir, file), "utf-8");
          const profile = this.parseProfile(content, file);
          this.profiles.set(this.normalizeKey(profile.name), profile);
        }
      }
    }
  } catch (err) {
    console.warn("[Agent] Failed to load user profiles:", err);
  }
  
  // 2. Load project profiles (override user if same name)
  const projectDir = join(cwd, ".pi", "agents");
  if (existsSync(projectDir)) {
    for (const file of readdirSync(projectDir)) {
      if (file.endsWith(".md")) {
        const content = readFileSync(join(projectDir, file), "utf-8");
        const profile = this.parseProfile(content, file);
        this.profiles.set(this.normalizeKey(profile.name), profile);
      }
    }
  }
}
```

---

### Spawner (in Agent.ts)

**Model priority**:
1. Agent profile's model (if specified)
2. systemAgent's model (if specified)
3. Default model: `openrouter/google/gemini-3-flash-preview`

**Tools priority**:
1. Agent profile's tools (if specified)
2. All available tools (read,bash,grep,find,ls,edit,glob,webfetch)

```typescript
async spawnAgent(options: {
  agentName: string;
  task: string;
  sessionKey?: string;
  continueSession?: boolean;
  timeout?: number;
}): Promise<AgentExecutionResult> {
  // 1. Get agent profile
  const agentProfile = this.profiles.get(this.normalizeKey(options.agentName));
  if (!agentProfile) {
    throw new Error(`Profile not found: ${options.agentName}`);
  }
  
  // 2. Determine model (profile → systemAgent → default)
  const model = agentProfile.model 
    || this.systemAgent?.model 
    || "openrouter/google/gemini-3-flash-preview";
  
  // 3. Determine tools (profile → all available)
  const tools = agentProfile.tools?.join(",") || "read,bash,grep,find,ls,edit,glob,webfetch";
  
  // 4. Get session file
  const sessionFile = options.sessionKey 
    ? join(this._sessionDir, `${options.sessionKey}.json`)
    : this.getSessionFile(options.agentName);
  
  const hasSession = existsSync(sessionFile);
  
  // 5. Build CLI args
  const args = [
    "--mode", "json",
    "-p",
    "--no-extensions",
    "--model", model,
    "--tools", tools,
    "--session", sessionFile,
    "--append-system-prompt", agentProfile.body,
  ];
  
  if (hasSession || options.continueSession) args.push("-c");
  args.push(options.task);
  
  // 6. Spawn, stream, return result
}
```

**AgentProfile interface**:
```typescript
interface AgentProfile {
  name: string;
  description: string;
  model?: string;      // Optional: override default model
  tools?: string[];    // Optional: specify tools
  body: string;        // System prompt
}
```

---

### 3. System.ts

**Purpose**: systemAgent profile selection - both user and agent can switch

**Activation**: `/system`

**Commands**:
| Command | Description |
|---------|-------------|
| `/system` | Open profile selector |
| `/system list` | Show all available profiles |
| `/system <name>` | Activate specific profile |

**Tools** (agent can call to switch systemAgent):
| Tool | Description |
|------|-------------|
| `switch_system` | Switch to a different systemAgent |
| `list_agents` | List all available agents |

**Tool Parameters**:
```typescript
// switch_system
{
  agent: string;  // Agent name to switch to
}

// list_agents
{}  // No parameters
```

**Tool Implementations**:
```typescript
// switch_system tool
pi.registerTool({
  name: "switch_system",
  description: "Switch the system agent to a different profile",
  parameters: Type.Object({
    agent: Type.String({ description: "Agent name to switch to" }),
  }),
  execute: async (params, ctx) => {
    const profile = agent.getProfile(params.agent);
    if (!profile) {
      return { content: [{ type: "text", text: `Agent "${params.agent}" not found` }] };
    }
    agent.setSystemAgent(params.agent);
    return { content: [{ type: "text", text: `Switched to ${params.agent}` }] };
  },
});

// list_agents tool
pi.registerTool({
  name: "list_agents",
  description: "List all available agent profiles",
  parameters: Type.Object({}),
  execute: async (_params, ctx) => {
    const profiles = agent.getProfiles();
    const list = profiles.map(p => `- ${p.name}: ${p.description}`).join("\n");
    return { content: [{ type: "text", text: `Available agents:\n${list}` }] };
  },
});
```

**Behavior**:
1. User types `/system` or agent calls tool
2. Shows list of available profiles with descriptions
3. User selects or agent switches via tool
4. systemAgent updated
5. System prompt injected on next agent turn

**Note**: Both user (via command) and agent (via tool) can switch the systemAgent.

**Code Flow**:
```typescript
registerCommand(pi, "system", {
  description: "Select agent profile: /system",
  handler: async (args, ctx) => {
    const profiles = agent.getProfiles();
    
    if (args?.trim()) {
      // Direct selection: /system builder
      const profile = profiles.find(p => p.name === args.trim());
      if (profile) {
        agent.setActiveProfile(profile.name);
        ctx.ui.notify(`Profile: ${profile.name}`, "info");
      }
    } else {
      // Interactive: /system
      const options = profiles.map(p => `${p.name} — ${p.description}`);
      const choice = await ctx.ui.select("Select Profile", options);
      // ... activate selected
    }
  }
});
```

**Edge Cases**:
- No profiles found → Show "No profiles in .pi/agents/" message
- Invalid profile name → Show available profiles
- Profile missing body → Use default: "You are a [name] agent."

---

### 4. Swarm.ts

**Purpose**: Parallel background agents - spawn multiple independent agents

**Activation**: `/swarm`

**Commands**:
| Command | Description |
|---------|-------------|
| `/swarm <task>` | Spawn background agent with task |
| `/swarm-cont <id> <prompt>` | Continue existing agent |
| `/swarm-rm <id>` | Remove agent |
| `/swarm-clear` | Remove all agents |
| `/swarm list` | Show active agents |

**Tools**:
| Tool | Description |
|------|-------------|
| `swarm_create` | Spawn background agent |
| `swarm_continue` | Continue agent conversation |
| `swarm_remove` | Remove agent |
| `swarm_list` | List all agents |

**Tool Parameters**:
```typescript
// swarm_create
{ task: string }

// swarm_continue  
{ id: number, prompt: string }

// swarm_remove
{ id: number }
```

**State**:
```typescript
private swarmAgents = new Map<number, SwarmState>();

interface SwarmState {
  id: number;
  status: "pending" | "running" | "done" | "error";
  task: string;
  output: string;
  elapsed: number;
  turnCount: number;
  sessionFile: string;
  proc?: ChildProcess;
}
```

**Behavior**:
1. User calls `/swarm <task>` or `swarm_create` tool
2. Create new SwarmState with ID
3. Spawn `pi` CLI with `--session` flag for persistence
4. Stream output to state.output
5. On completion, send message to main agent with result
6. Update widget showing all swarm agents

**Widget**:
```typescript
ctx.ui.setWidget("agent-swarm", (_tui, theme) => {
  return {
    render: (width) => {
      const lines = Array.from(swarmAgents.values()).map(s => 
        `${s.id}: [${s.status}] ${s.task.slice(0, 40)}`
      );
      return lines;
    }
  };
});
```

**Error Handling**:
- CLI spawn fails → Set status "error", output = `Error: ${err.message}`
- Agent timeout (5 min) → Kill process, set status "error"
- JSON parse error → Ignore malformed lines

---

### 5. Team.ts

**Purpose**: Team mode - supervised dispatch with main agent (systemAgent) delegating to team members

**Activation**: `/team`

**Commands**:
| Command | Description |
|---------|-------------|
| `/team` | Open interactive team builder (checkbox selection) |
| `/team add <name>` | Add agent to team |
| `/team remove <name>` | Remove agent from team |
| `/team list` | Show current team |
| `/team clear` | Clear team |

**Interactive Team Builder** (`/team`):
```
--------------------------
[x]: agent 1
[ ]: agent 2
[x]: agent 3
[x]: agent 4
----
[Space] Toggle [P] Set Prompt [A] Select All [C] Clear All [Enter] Confirm [Esc] Cancel
--------------------------
```

**Set Prompt** ([P] key):
- For each team member, press [P] to set custom prompt
- Prompt template with `$INPUT` placeholder (task input)
- Default: `$INPUT` (pass through unchanged)

```
--------------------------------
| <Agent Name>                 |
| Prompt:                      |
| ┌────────────────────────┐   |
| | $INPUT                 |   |
| └────────────────────────┘   |
--------------------------------
[Enter] Confirm [Esc] Cancel
```

- Shows all available profiles as checkboxes
- User selects which agents to include in team
- Save applies selected agents as team members
- Agent mode automatically activated when team is set

**Tools**:
| Tool | Description |
|------|-------------|
| `dispatch_agent` | Send task to team member |

**Tool Parameters**:
```typescript
// dispatch_agent
{
  agent: string;  // Team member name
  task: string;   // Task to dispatch
}
```

**State**:
```typescript
private activeTeam: string[] = [];  // Team member names

private teamStates = new Map<string, TeamState>();

interface TeamState {
  name: string;
  prompt: string;  // Custom prompt template ($INPUT = task input)
  status: "idle" | "running" | "done" | "error";
  task: string;
  output: string;
  elapsed: number;
  runCount: number;
  sessionFile: string;
}
```

**Behavior**:
1. User types `/team` → Opens interactive checkbox builder
2. User selects team members from available profiles
3. Save → Team members set, mode set to "team"
4. Main agent (systemAgent) uses `dispatch_agent` tool to delegate
5. Agent spawns with team member's profile
6. Output returns directly to main agent (not as message)
7. Main agent reviews output and continues

**Direct Handoff**:
- dispatch_agent output becomes part of main agent's conversation
- Main agent can immediately act on team member's output

**Chain Builder Flow** (`/chain` interactive):
```typescript
// /chain - interactive chain builder
handler: async (args, ctx) => {
  const profiles = agent.getProfiles();
  const profileNames = profiles.map(p => p.name);
  
  // Show current chain state
  const currentChain = agent.getChainSteps();
  const selected = profileNames.map(name => 
    currentChain.filter(s => s.agent === name).length
  );
  
  // Use ctx.ui.custom for checkbox + order UI
  const result = await ctx.ui.custom<{ steps: ChainStep[] }>(
    (tui, theme) => new ChainBuilderWidget(profiles, currentChain)
  );
  
  if (result?.steps && result.steps.length > 0) {
    agent.setChainSteps(result.steps);
    agent.setMode("chain");  // Activate chain mode
  }
}
```

**Chain Prompt Template**:
Each step can have a prompt template. Default: `$INPUT` (pass previous output directly).

Example chain with custom prompts:
```
agent 1: "Analyze: $INPUT"
agent 2: "Summarize: $INPUT"
agent 1: "Review: $INPUT"
```

**Note**: Chain mode is automatically activated when chain steps are set.

---

### 6. Chain.ts

**Purpose**: Chain mode - sequential workflow where output from one agent becomes input for the next

**Activation**: `/chain`

**Commands**:
| Command | Description |
|---------|-------------|
| `/chain` | Open interactive chain builder (ordered selection) |
| `/chain add <name>` | Add agent to chain (appends to end) |
| `/chain remove <index>` | Remove agent at index |
| `/chain list` | Show current chain |
| `/chain clear` | Clear chain |

**Interactive Chain Builder** (`/chain`):
```
--------------------------
[x]: agent 1
[x]: agent 2
[ ]: agent 3
[x]: agent 4
----
[Space] Select, [P] Set Prompt, [A] Select All [C] Clear All [Enter] Confirm [Esc] Cancel
--------------------
Current Chain:
agent 1 -> agent 2 -> agent 4
--------------------------
```

**Set Prompt** ([P] key):
- When agent is selected in chain, press [P] to set custom prompt
- Prompt template with `$INPUT` placeholder (previous output)
- Default: `$INPUT` (pass through unchanged)

```
--------------------------------
| <Agent Name>                 |
| Prompt:                      |
| ┌────────────────────────┐   |
| | $INPUT                 |   |
| └────────────────────────┘   |
--------------------------------
[Enter] Confirm [Esc] Cancel
```

**Key features**:
- Checkbox selection (like Team)
- Press [P] on selected agent to set custom prompt
- Shows current chain order below checkboxes
- **Allows same agent multiple times** (e.g., `agent 1 -> agent 2 -> agent 1`)

**Tools**:
| Tool | Description |
|------|-------------|
| `run_chain` | Execute the chain pipeline |

**Tool Parameters**:
```typescript
// run_chain
{
  task: string;  // Initial task for first agent
}
```

**State**:
```typescript
// Chain stores ordered steps (allows duplicates)
private chainSteps: ChainStep[] = [];  // [{ agent: string, prompt: string }]

interface ChainStep {
  agent: string;
  prompt: string;  // Template with $INPUT placeholder
}

interface ChainStepState {
  agent: string;
  status: "pending" | "running" | "done" | "error";
  elapsed: number;
  output: string;
}
```

**Behavior**:
1. User types `/chain` → Opens interactive checkbox builder
2. User selects agents (can select same agent multiple times)
3. Confirm → Chain steps set, mode set to "chain"
4. User calls `run_chain` tool with initial task
5. First agent runs with task
6. Output → input for next agent (replace `$INPUT` in prompt)
7. Continue until all steps complete
8. Return final output to main agent

**Direct Handoff**:
```typescript
// Step execution
for (const step of chain.steps) {
  // Replace $INPUT with previous output
  const task = step.prompt.replace(/\$INPUT/g, previousOutput);
  
  const result = await agent.spawnAgent({
    agentName: step.agent,
    task: task,
  });
  
  if (result.exitCode !== 0) {
    // Retry once
    const retry = await agent.spawnAgent({...});
    if (retry.exitCode !== 0) {
      return { content: [{ type: "text", text: `Error: ${retry.output}` }] };
    }
  }
  
  previousOutput = result.output;
}
```

**Error Handling**:
- No active chain → Show "No chain. Use /chain to build one."
- Agent not found → Show error at that step
- Step fails → Retry once, then stop and report error
- Timeout → Kill process, continue to next or fail

---

## Shared Utilities (in Agent.ts)

### AgentState - All state in Agent class

```typescript
interface AgentState {
  activeMode: AgentMode;  // "single" | "team" | "chain" | "swarm"
  
  systemAgent: AgentProfile | null;
  profiles: Map<string, AgentProfile>;
  
  teamMembers: string[];
  teamStates: Map<string, TeamState>;
  
  chainSteps: ChainStep[];
  chainStepStates: ChainStepState[];
  
  swarmAgents: Map<number, SwarmState>;
  sessionDir: string;
}
```

All core functionality (state, profiles, spawner, mode management) is in Agent.ts. Other modes call Agent methods.

```typescript
async spawnAgent(options: {
  agentName: string;
  task: string;
  sessionKey?: string;      // Optional session override
  continueSession?: boolean;
  timeout?: number;        // Default 300000ms
}): Promise<{
  output: string;
  exitCode: number;
  elapsed: number;
}> {
  const profile = this.profiles.get(agentName);
  if (!profile) {
    throw new Error(`Profile not found: ${agentName}`);
  }
  
  const sessionFile = this.getSessionFile(agentName);
  const hasSession = existsSync(sessionFile);
  
  const args = [
    "--mode", "json",
    "-p",
    "--no-extensions",
    "--model", ctx.model?.id || "default",
    "--tools", profile.tools?.join(",") || "read,bash,grep,find,ls",
    "--session", sessionFile,
  ];
  
  if (hasSession) args.push("-c");
  
  // Spawn, stream output, return result
}
```

---

## Implementation Order

### Phase 1: Core Infrastructure
1. **Agent.ts** - Basic class, initialize, profile loading
2. **index.ts** - Entry point with session_start
3. **System.ts** - Basic profile listing

### Phase 2: Single Agent Mode
4. **Swarm.ts** - Basic spawn and list (single agent first)
5. Test: spawn one background agent, receive result

### Phase 3: Multi-Agent Modes
6. **Team.ts** - Basic dispatch
7. **Chain.ts** - Basic sequential (2 steps)
8. Test: dispatch to team, run chain

### Phase 4: Polish
9. Error handling (retry logic)
10. Widget updates
11. Command handlers
12. System prompt injection

---

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| No profiles | Show "No profiles" message, continue without profile |
| Profile not found | Return error to tool caller |
| CLI spawn fails | Return error message, log to console |
| Agent timeout | Kill process, return timeout error |
| JSON parse error | Ignore line, continue |
| Session file missing | Continue without session |

---

## Key Design Decisions

1. **All core in Agent.ts** - State, profiles, spawner, mode management all in one class
2. **systemAgent is main** - Always the agent coordinating, regardless of mode
3. **Single active mode** - Only one mode active at a time (single/team/chain/swarm)
4. **Modes use Agent methods** - System, Swarm, Team, Chain get data via Agent methods
5. **Command-first** - Users build teams/chains via commands, then use tools
6. **Direct handoff** - Team/Chain output becomes input for next step
7. **Retry once** - Failed agents retry once before failing
8. **CLI spawn** - Use `pi` CLI for agent execution

---

## Testing Checklist

- [ ] Profiles load from `.pi/agents/`
- [ ] `/system` shows profiles, selection works
- [ ] systemAgent is set correctly after selection
- [ ] Mode switching works (/single, /team, /chain, /swarm)
- [ ] `/swarm <task>` spawns agent, widget updates
- [ ] `swarm_list` shows all agents
- [ ] Swarm completion sends message to main agent
- [ ] `/team add <name>` builds team
- [ ] `dispatch_agent` calls team member, returns output
- [ ] `/chain add <name>` builds chain
- [ ] `run_chain` executes steps sequentially
- [ ] Chain handoff works ($INPUT replacement)
- [ ] Error: agent not found → proper error message
- [ ] Error: spawn fails → retry then fail gracefully

---

## Configuration

- Profile files: `.pi/agents/*.md`
- Session directory: `.pi/agent-sessions/`
- No external config files needed (all built via commands)
