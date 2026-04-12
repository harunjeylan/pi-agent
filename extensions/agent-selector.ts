/**
 * Agent Selector Extension - Single file version
 *
 * Discovers and manages session agent profiles from ~/.pi/agents and .pi/agents
 * Allows users to select, activate, and cycle through agent profiles
 */
import * as fs from "node:fs";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  DynamicBorder,
  getAgentDir,
  parseFrontmatter,
} from "@mariozechner/pi-coding-agent";
import {
  Box,
  Container,
  type SelectItem,
  SelectList,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

// ============================================================================
// Types
// ============================================================================

export const AGENT_STATE_ENTRY = "session-agent-selector";
export const CLEAR_SELECTION_VALUE = "__clear_active_agent__";

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface AgentProfile {
  name: string;
  path: string;
  description?: string;
  model?: string;
  provider?: string;
  modelId?: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  body: string;
}

export interface PersistedAgentState {
  action: "set" | "clear";
  path?: string;
  name?: string;
  previousModel?: string;
  agentAppliedModel?: string;
  previousThinking?: ThinkingLevel;
  agentAppliedThinking?: ThinkingLevel;
  timestamp: number;
}

export interface ActivationResult {
  appliedModel?: string;
  appliedThinking?: ThinkingLevel;
  appliedTools: string[];
  ignoredTools: string[];
  warnings: string[];
}

export interface ParseAgentFileResult {
  profile?: AgentProfile;
  warnings: string[];
}

export interface DiscoverAgentProfilesResult {
  profiles: AgentProfile[];
  warnings: string[];
}

// ============================================================================
// State Management
// ============================================================================

interface SessionEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
}

function getLastPersistedAgentState(
  entries: SessionEntryLike[],
): PersistedAgentState | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== AGENT_STATE_ENTRY)
      continue;
    const data = entry.data as PersistedAgentState | undefined;
    if (!data || (data.action !== "set" && data.action !== "clear")) continue;
    return data;
  }
  return undefined;
}

// ============================================================================
// Parser
// ============================================================================

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

function parseModelRef(
  model: string,
): { provider: string; modelId: string } | undefined {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;

  const provider = model.slice(0, slash).trim();
  const modelId = model.slice(slash + 1).trim();
  if (!provider || !modelId) return undefined;

  return { provider, modelId };
}

function normalizeThinking(
  value: unknown,
  warnings: string[],
  agentName: string,
): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    warnings.push(
      `Ignored invalid thinking value in ${agentName}: expected string.`,
    );
    return undefined;
  }

  const normalized = value.trim() as ThinkingLevel;
  if (!THINKING_LEVELS.includes(normalized)) {
    warnings.push(`Ignored invalid thinking value in ${agentName}: ${value}.`);
    return undefined;
  }

  return normalized;
}

function normalizeTools(
  value: unknown,
  warnings: string[],
  agentName: string,
): string[] | undefined {
  if (value === undefined) return undefined;

  let tools: string[] = [];

  if (typeof value === "string") {
    tools = value
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
  } else if (Array.isArray(value)) {
    tools = value
      .filter((tool): tool is string => typeof tool === "string")
      .map((tool) => tool.trim())
      .filter(Boolean);
    if (tools.length !== value.length) {
      warnings.push(`Ignored non-string tool entries in ${agentName}.`);
    }
  } else {
    warnings.push(
      `Ignored invalid tools value in ${agentName}: expected string or list.`,
    );
    return undefined;
  }

  const uniqueTools = Array.from(new Set(tools));
  return uniqueTools.length > 0 ? uniqueTools : undefined;
}

async function parseAgentFile(path: string): Promise<ParseAgentFileResult> {
  const warnings: string[] = [];
  const absolutePath = resolve(path);
  const fileName = basename(absolutePath, extname(absolutePath));

  try {
    const source = await readFileAsync(absolutePath, "utf8");
    const { frontmatter, body } =
      parseFrontmatter<Record<string, unknown>>(source);
    const data = frontmatter ?? {};
    const model =
      typeof data.model === "string" && data.model.trim()
        ? data.model.trim()
        : undefined;
    const modelRef = model ? parseModelRef(model) : undefined;

    if (model && !modelRef) {
      warnings.push(
        `Ignored invalid model value in ${fileName}: ${model}. Expected provider/model.`,
      );
    }

    const description =
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : undefined;

    const profile: AgentProfile = {
      name: fileName,
      path: absolutePath,
      description,
      model,
      provider: modelRef?.provider,
      modelId: modelRef?.modelId,
      thinking: normalizeThinking(data.thinking, warnings, fileName),
      tools: normalizeTools(data.tools, warnings, fileName),
      body: body.trim(),
    };

    return { profile, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      warnings: [`Skipped invalid agent file ${absolutePath}: ${message}`],
    };
  }
}

// ============================================================================
// Discovery
// ============================================================================

const MAX_AGENT_FILE_BYTES = 100 * 1024;

function normalizeExistingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function getSupportedAgentDirectories(ctx: ExtensionContext): string[] {
  const agentDir = getAgentDir();
  const cwd = ctx.cwd;
  const candidateDirs = [
    join(agentDir, "agents"),
    join(agentDir, "..", "agents"),
    join(cwd, ".pi", "agents"),
  ];

  return Array.from(
    new Set(
      candidateDirs
        .map((dir) => normalizeExistingPath(dir))
        .filter((dir) => isDirectory(dir)),
    ),
  );
}

async function discoverAgentProfiles(
  ctx: ExtensionContext,
): Promise<DiscoverAgentProfilesResult> {
  const uniqueFiles = new Set<string>();
  const warnings: string[] = [];

  for (const dir of getSupportedAgentDirectories(ctx)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".md")) continue;

      const filePath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        warnings.push(
          `Skipped symlinked agent profile ${filePath}: symlinks are not allowed.`,
        );
        continue;
      }

      if (!entry.isFile()) continue;

      try {
        const stats = statSync(filePath);
        if (stats.size > MAX_AGENT_FILE_BYTES) {
          warnings.push(
            `Skipped oversized agent profile ${filePath}: ${stats.size} bytes exceeds ${MAX_AGENT_FILE_BYTES} byte limit.`,
          );
          continue;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Skipped unreadable agent profile ${filePath}: ${message}`,
        );
        continue;
      }

      uniqueFiles.add(normalizeExistingPath(filePath));
    }
  }

  const profiles: AgentProfile[] = [];

  for (const path of uniqueFiles) {
    const result = await parseAgentFile(path);
    warnings.push(...result.warnings);
    if (result.profile) profiles.push(result.profile);
  }

  profiles.sort((left, right) => {
    const nameCompare = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
    if (nameCompare !== 0) return nameCompare;
    return left.path.localeCompare(right.path, undefined, {
      sensitivity: "base",
    });
  });

  return { profiles, warnings };
}

// ============================================================================
// UI Functions
// ============================================================================

function formatProfileSummary(
  profile: AgentProfile,
  includePath: boolean,
): string {
  const parts: string[] = [];
  if (profile.description) parts.push(profile.description);
  if (profile.model) parts.push(profile.model);
  if (profile.thinking) parts.push(`thinking:${profile.thinking}`);
  if (includePath) parts.push(profile.path);
  return parts.length > 0 ? parts.join(" | ") : profile.path;
}

function buildDuplicateNameSet(profiles: AgentProfile[]): Set<string> {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const key = profile.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicates = new Set<string>();
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name);
  }
  return duplicates;
}

async function showAgentPicker(
  ctx: ExtensionContext,
  profiles: AgentProfile[],
  activeProfilePath?: string,
): Promise<string | null> {
  const duplicateNames = buildDuplicateNameSet(profiles);
  const items: SelectItem[] = profiles.map((profile) => ({
    value: profile.path,
    label:
      profile.path === activeProfilePath
        ? `${profile.name} (active)`
        : profile.name,
    description: formatProfileSummary(
      profile,
      duplicateNames.has(profile.name.toLowerCase()),
    ),
  }));

  items.push({
    value: CLEAR_SELECTION_VALUE,
    label: "(clear active agent)",
    description: "Remove the active profile overlay from this session",
  });

  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
    container.addChild(
      new Text(theme.fg("accent", theme.bold("Select Session Agent"))),
    );

    const selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    container.addChild(selectList);
    container.addChild(
      new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")),
    );
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });

  return result ?? null;
}

function buildBodyPreview(body: string, maxLines = 10, maxChars = 500): string {
  const trimmed = body.trim();
  if (!trimmed) return "(no body content)";

  const allLines = trimmed.split(/\r?\n/);
  const lines = allLines.slice(0, maxLines);
  let preview = lines.join("\n");
  if (preview.length > maxChars) {
    preview = `${preview.slice(0, maxChars - 3)}...`;
  }

  if (lines.length < allLines.length || preview.length < trimmed.length) {
    preview += "\n...";
  }

  return preview;
}

function formatProfileDetails(profile: AgentProfile): string {
  const lines = [
    `Name: ${profile.name}`,
    `Path: ${profile.path}`,
    `Description: ${profile.description ?? "(none)"}`,
    `Model: ${profile.model ?? "(none)"}`,
    `Thinking: ${profile.thinking ?? "(none)"}`,
    `Tools: ${profile.tools && profile.tools.length > 0 ? profile.tools.join(", ") : "(none)"}`,
    "",
    "Preview:",
    buildBodyPreview(profile.body),
  ];

  return lines.join("\n");
}

function registerAgentProfileMessageRenderer(pi: {
  registerMessageRenderer: (
    customType: string,
    renderer: (
      message: { content: string },
      options: { expanded: boolean },
      theme: any,
    ) => any,
  ) => void;
}) {
  pi.registerMessageRenderer(
    "session-agent-profile",
    (message, _options, theme) => {
      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(new Text(message.content, 0, 0));
      return box;
    },
  );
}

// ============================================================================
// Main Extension
// ============================================================================

function persistState(pi: ExtensionAPI, data: PersistedAgentState) {
  pi.appendEntry<PersistedAgentState>(AGENT_STATE_ENTRY, data);
}

function updateStatus(ctx: ExtensionContext, profile?: AgentProfile) {
  ctx.ui.setStatus("session-agent", profile ? `${profile.name}` : undefined);
}

function summarizeWarnings(warnings: string[]): string | undefined {
  if (warnings.length === 0) return undefined;
  if (warnings.length === 1) return warnings[0];
  return `Encountered ${warnings.length} agent profile warning(s). See console for details.`;
}

function reportWarnings(
  ctx: ExtensionContext,
  warnings: string[],
  source: "scan" | "activation" | "restore",
) {
  if (warnings.length === 0) return;
  for (const warning of warnings)
    console.warn(`[session-agent-selector:${source}] ${warning}`);
  const summary = summarizeWarnings(warnings);
  if (summary) ctx.ui.notify(summary, "warning");
}

function findProfilesByName(
  profiles: AgentProfile[],
  input: string,
): AgentProfile[] {
  const normalized = input.trim().toLowerCase();
  return profiles.filter(
    (profile) => profile.name.toLowerCase() === normalized,
  );
}

function buildProviderSuggestion(profile: AgentProfile): string | undefined {
  if (!profile.model) return undefined;
  return "If you intend to use this model through a different provider or proxy, specify that provider's exact model identifier in the agent file.";
}

function buildMissingModelWarning(profile: AgentProfile): string {
  const parts = [
    `Model not found in pi's registry: ${profile.model}. Agent model values must match pi provider/model identifiers exactly.`,
  ];
  const suggestion = buildProviderSuggestion(profile);
  if (suggestion) parts.push(suggestion);
  return parts.join(" ");
}

function buildCredentialWarning(profile: AgentProfile): string {
  const parts = [
    `Model ${profile.model} resolved to provider "${profile.provider}", but no credentials were available for that provider in this session.`,
  ];
  const suggestion = buildProviderSuggestion(profile);
  if (suggestion) parts.push(suggestion);
  return parts.join(" ");
}

function getModelRef(
  model: { provider: string; id: string } | undefined,
): string | undefined {
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}

function buildActivationSummary(
  profile: AgentProfile,
  result: ActivationResult,
): string {
  const lines = [`Activated agent: ${profile.name}`];
  if (result.appliedModel) lines.push(`Model: ${result.appliedModel}`);
  if (result.appliedThinking) lines.push(`Thinking: ${result.appliedThinking}`);
  if (profile.tools) {
    lines.push(
      `Tools: ${result.appliedTools.length > 0 ? result.appliedTools.join(", ") : "(none)"}`,
    );
  }
  if (result.ignoredTools.length > 0)
    lines.push(`Ignored tools: ${result.ignoredTools.join(", ")}`);
  if (result.warnings.length > 0) lines.push(...result.warnings);
  return lines.join("\n");
}

export default function sessionAgentSelector(pi: ExtensionAPI) {
  let activeProfile: AgentProfile | undefined;
  let previousModelBeforeActivation: string | undefined;
  let agentAppliedModel: string | undefined;
  let previousThinkingBeforeActivation: ThinkingLevel | undefined;
  let agentAppliedThinking: ThinkingLevel | undefined;
  const counts: Record<string, number> = {};
  let index = 0;

  registerAgentProfileMessageRenderer(pi as any);

  async function refreshProfiles(
    ctx: ExtensionContext,
  ): Promise<AgentProfile[]> {
    const result = await discoverAgentProfiles(ctx);
    reportWarnings(ctx, result.warnings, "scan");
    return result.profiles;
  }

  async function clearActiveProfile(
    ctx: ExtensionContext,
    options?: { persist?: boolean; notify?: boolean },
  ) {
    const clearWarnings: string[] = [];
    const currentModelRef = getModelRef(ctx.model);
    const currentThinking = pi.getThinkingLevel();

    if (
      agentAppliedModel &&
      previousModelBeforeActivation &&
      currentModelRef === agentAppliedModel
    ) {
      const slashIndex = previousModelBeforeActivation.indexOf("/");
      if (
        slashIndex > 0 &&
        slashIndex < previousModelBeforeActivation.length - 1
      ) {
        const provider = previousModelBeforeActivation.slice(0, slashIndex);
        const modelId = previousModelBeforeActivation.slice(slashIndex + 1);
        const previousModel = ctx.modelRegistry.find(provider, modelId);
        if (previousModel) {
          const restored = await pi.setModel(previousModel);
          if (!restored) {
            clearWarnings.push(
              `Could not restore previous model ${previousModelBeforeActivation}: credentials unavailable.`,
            );
          }
        } else {
          clearWarnings.push(
            `Could not restore previous model ${previousModelBeforeActivation}: model not found.`,
          );
        }
      }
    }

    if (
      agentAppliedThinking !== undefined &&
      previousThinkingBeforeActivation !== undefined &&
      currentThinking === agentAppliedThinking
    ) {
      pi.setThinkingLevel(previousThinkingBeforeActivation);
    }

    activeProfile = undefined;
    previousModelBeforeActivation = undefined;
    agentAppliedModel = undefined;
    previousThinkingBeforeActivation = undefined;
    agentAppliedThinking = undefined;
    updateStatus(ctx, undefined);

    if (options?.persist !== false) {
      persistState(pi, { action: "clear", timestamp: Date.now() });
    }

    if (options?.notify !== false) {
      const lines = ["Active agent cleared."];
      if (clearWarnings.length === 0) {
        lines.push(
          "Model and thinking were restored only if they were still using the agent-applied values.",
        );
      } else {
        lines.push(...clearWarnings);
      }
      ctx.ui.notify(
        lines.join("\n"),
        clearWarnings.length > 0 ? "warning" : "info",
      );
    }
  }

  function showProfileMessage(
    content: string,
    details?: Record<string, unknown>,
  ) {
    pi.sendMessage({
      customType: "session-agent-profile",
      content,
      display: true,
      details,
    });
  }

  async function activateProfile(
    profile: AgentProfile,
    ctx: ExtensionContext,
    options?: {
      persist?: boolean;
      notify?: boolean;
      source?: "user" | "restore";
    },
  ): Promise<ActivationResult> {
    const warnings: string[] = [];
    const result: ActivationResult = {
      appliedTools: [],
      ignoredTools: [],
      warnings,
    };

    const currentModelRef = getModelRef(ctx.model);
    const currentThinking = pi.getThinkingLevel();

    if (profile.provider && profile.modelId) {
      const model = ctx.modelRegistry.find(profile.provider, profile.modelId);
      if (!model) {
        warnings.push(buildMissingModelWarning(profile));
      } else {
        const success = await pi.setModel(model);
        if (success) {
          result.appliedModel = `${profile.provider}/${profile.modelId}`;
        } else {
          warnings.push(buildCredentialWarning(profile));
        }
      }
    } else if (profile.model) {
      warnings.push(`Ignored invalid model value: ${profile.model}`);
    }

    if (profile.thinking) {
      pi.setThinkingLevel(profile.thinking);
      result.appliedThinking = profile.thinking;
    }

    if (profile.tools) {
      const allToolNames = new Set(pi.getAllTools().map((tool) => tool.name));
      const validTools = profile.tools.filter((tool) => allToolNames.has(tool));
      const invalidTools = profile.tools.filter(
        (tool) => !allToolNames.has(tool),
      );
      result.appliedTools = validTools;
      result.ignoredTools = invalidTools;
      if (invalidTools.length > 0) {
        warnings.push(`Ignored unknown tools: ${invalidTools.join(", ")}`);
      }

      if (profile.tools.length === 0 || validTools.length > 0) {
        pi.setActiveTools(validTools);
      } else {
        warnings.push(
          "No valid tools were found in the profile. Current active tools were left unchanged.",
        );
      }
    }

    activeProfile = profile;
    previousModelBeforeActivation = currentModelRef;
    agentAppliedModel = result.appliedModel;
    previousThinkingBeforeActivation = currentThinking;
    agentAppliedThinking = result.appliedThinking;
    updateStatus(ctx, profile);

    if (options?.persist !== false) {
      persistState(pi, {
        action: "set",
        path: profile.path,
        name: profile.name,
        previousModel: previousModelBeforeActivation,
        agentAppliedModel,
        previousThinking: previousThinkingBeforeActivation,
        agentAppliedThinking,
        timestamp: Date.now(),
      });
    }

    if (options?.source === "restore") {
      reportWarnings(ctx, warnings, "restore");
    }

    if (options?.notify !== false) {
      ctx.ui.notify(
        buildActivationSummary(profile, result),
        warnings.length > 0 ? "warning" : "info",
      );
    }

    return result;
  }

  async function restoreActiveProfileFromBranch(
    ctx: ExtensionContext,
    profiles?: AgentProfile[],
  ) {
    const state = getLastPersistedAgentState(
      ctx.sessionManager.getBranch() as Array<{
        type?: string;
        customType?: string;
        data?: unknown;
      }>,
    );
    if (!state || state.action === "clear") {
      activeProfile = undefined;
      previousModelBeforeActivation = undefined;
      agentAppliedModel = undefined;
      previousThinkingBeforeActivation = undefined;
      agentAppliedThinking = undefined;
      updateStatus(ctx, undefined);
      return;
    }

    const availableProfiles = profiles ?? (await refreshProfiles(ctx));
    const profile = state.path
      ? availableProfiles.find((item) => item.path === state.path)
      : undefined;
    if (!profile) {
      activeProfile = undefined;
      previousModelBeforeActivation = undefined;
      agentAppliedModel = undefined;
      previousThinkingBeforeActivation = undefined;
      agentAppliedThinking = undefined;
      updateStatus(ctx, undefined);
      persistState(pi, { action: "clear", timestamp: Date.now() });
      ctx.ui.notify(
        `Previously selected agent is no longer available: ${state.path ?? state.name ?? "unknown"}`,
        "warning",
      );
      return;
    }

    const restoredActivation = await activateProfile(profile, ctx, {
      persist: false,
      notify: false,
      source: "restore",
    });
    previousModelBeforeActivation = state.previousModel;
    agentAppliedModel =
      state.agentAppliedModel ?? restoredActivation.appliedModel;
    previousThinkingBeforeActivation = state.previousThinking;
    agentAppliedThinking =
      state.agentAppliedThinking ?? restoredActivation.appliedThinking;
  }

  pi.on("tool_execution_end", async (event) => {
    counts[event.toolName] = (counts[event.toolName] || 0) + 1;
  });

  pi.on("session_start", async (_event, ctx) => {
    const profiles = await refreshProfiles(ctx);
    await restoreActiveProfileFromBranch(ctx, profiles);

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // --- Line 1: cwd + branch (left), tokens + cost (right) ---
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
          const dir = basename(ctx.cwd);
          const branch = footerData.getGitBranch();
          const status = footerData.getExtensionStatuses();
          const sessionAgent = status.get("session-agent");

          // --- Line 1: model + context meter (left), tokens + cost (right) ---
          const usage = ctx.getContextUsage();
          const pct = usage ? usage.percent : 0;
          const filled = Math.round((pct || 0) / 10) || 1;
          const bar = "#".repeat(filled) + "-".repeat(10 - filled);
          const model = ctx.model?.id || "no-model";

          const l1Left =
            (sessionAgent ? theme.fg("dim", ` ${sessionAgent}:`) : "") +
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

          // --- Line 2: cwd + branch (left), tool tally (right) ---
          const l2Left =
            theme.fg("dim", ` ${dir}`) +
            (branch
              ? theme.fg("dim", " ") +
                theme.fg("warning", "(") +
                theme.fg("success", branch) +
                theme.fg("warning", ")")
              : "");

          const entries = Object.entries(counts);
          const l2Right =
            entries.length === 0
              ? theme.fg("dim", "waiting for tools ")
              : entries
                  .map(
                    ([name, count]) =>
                      theme.fg("accent", name) +
                      theme.fg("dim", " ") +
                      theme.fg("success", `${count}`),
                  )
                  .join(theme.fg("warning", " | ")) + theme.fg("dim", " ");

          const pad2 = " ".repeat(
            Math.max(1, width - visibleWidth(l2Left) - visibleWidth(l2Right)),
          );
          const line2 = truncateToWidth(l2Left + pad2 + l2Right, width, "");

          return [line1, line2];
        },
      };
    });
  });

  pi.on("session_tree", async (_event, ctx) => {
    await restoreActiveProfileFromBranch(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    if (!activeProfile?.body.trim()) return;

    const descriptionLine = activeProfile.description
      ? `Description: ${activeProfile.description}\n\n`
      : "";
    return {
      systemPrompt:
        `${event.systemPrompt}\n\n## Active Session Agent Profile\n\n` +
        `The following profile is active for this session. ` +
        `Follow it unless it conflicts with higher-priority runtime, safety, or tool instructions.\n\n` +
        `Profile name: ${activeProfile.name}\n` +
        descriptionLine +
        activeProfile.body,
    };
  });

  async function cycleAgent(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const profiles = await refreshProfiles(ctx);
    if (index === -1) {
      index = 0;
    } else {
      index++;
      if (index >= profiles.length) index = 0;
    }
    const selectedProfile = profiles[index];
    if (!selectedProfile) {
      ctx.ui.notify(
        "Selected agent profile could not be resolved. Please try again.",
        "error",
      );
      return;
    }

    await activateProfile(selectedProfile, ctx, { source: "user" });
  }

  // --- Shortcuts ---
  pi.registerShortcut("alt+a", {
    description: "Cycle agent forward",
    handler: async (ctx) => {
      cycleAgent(ctx);
    },
  });

  pi.registerCommand("agent", {
    description: "Select or inspect the active session agent profile",
    handler: async (args, ctx) => {
      const input = args?.trim() ?? "";
      const profiles = await refreshProfiles(ctx);

      if (!input) {
        if (profiles.length === 0) {
          ctx.ui.notify(
            "No agent profiles found in ~/.pi/agent/agents or ~/.pi/agents",
            "warning",
          );
          return;
        }

        if (!ctx.hasUI) {
          const names = profiles
            .map((profile) => `- ${profile.name}`)
            .join("\n");
          showProfileMessage(`Available agent profiles:\n${names}`);
          return;
        }

        const selection = await showAgentPicker(
          ctx,
          profiles,
          activeProfile?.path,
        );
        if (!selection) return;
        if (selection === CLEAR_SELECTION_VALUE) {
          await clearActiveProfile(ctx);
          return;
        }

        const selectedProfile = profiles.find(
          (profile) => profile.path === selection,
        );
        if (!selectedProfile) {
          ctx.ui.notify(
            "Selected agent profile could not be resolved. Please try again.",
            "error",
          );
          return;
        }

        await activateProfile(selectedProfile, ctx, { source: "user" });
        return;
      }

      if (input.toLowerCase() === "clear") {
        await clearActiveProfile(ctx);
        return;
      }

      if (input.toLowerCase() === "show") {
        if (!activeProfile) {
          ctx.ui.notify("No active agent profile.", "info");
          return;
        }

        showProfileMessage(formatProfileDetails(activeProfile), {
          path: activeProfile.path,
        });
        return;
      }

      const matches = findProfilesByName(profiles, input);
      if (matches.length === 0) {
        ctx.ui.notify(`Unknown agent profile: ${input}`, "error");
        return;
      }

      if (matches.length > 1) {
        const collisionList = matches
          .map((profile) => `- ${profile.name} (${profile.path})`)
          .join("\n");
        showProfileMessage(
          `Multiple agent profiles named "${input}" were found. Use /agent to select one explicitly.\n\n${collisionList}`,
        );
        return;
      }

      await activateProfile(matches[0], ctx, { source: "user" });
    },
  });
}
