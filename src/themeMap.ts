/**
 * themeMap.ts — Persistent theme management with synthwave default
 *
 * Theme is loaded from settings.json on boot. If not set, defaults to "synthwave".
 * Every successful theme application is persisted to settings.json.
 *
 * Available themes (.pi/themes/):
 *   synthwave (default)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_THEME = "synthwave";
const SETTINGS_PATH = dirname(fileURLToPath(import.meta.url)) + "/../settings.json";

// ── Settings persistence ───────────────────────────────────────────────────

interface Settings {
  theme?: string;
}

function loadSettings(): Settings {
  try {
    const content = readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveSettings(settings: Settings): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

// ── Title helper ─────────────────────────────────────────────────────────

/**
 * Read process.argv to find the first -e / --extension flag value.
 *
 * When Pi is launched as:
 *   pi -e extensions/subagent-widget.ts -e extensions/pure-focus.ts
 *
 * process.argv contains those paths verbatim. Every stacked extension calls
 * this and gets the same answer ("subagent-widget"), so all setTitle calls
 * are idempotent — no shared state or deduplication needed.
 *
 * Returns null if no -e flag is present (e.g. plain `pi` with no extensions).
 */
function primaryExtensionName(): string | null {
  const argv = process.argv;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "-e" || argv[i] === "--extension") {
      return basename(argv[i + 1]).replace(/\.[^.]+$/, "");
    }
  }
  return null;
}

/**
 * Set the terminal title to "π - <first-extension-name>" on session boot.
 * Reads the title from process.argv so all stacked extensions agree on the
 * same value — no coordination or shared state required.
 *
 * Deferred 150 ms to fire after Pi's own startup title-set.
 */
function applyExtensionTitle(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const name = primaryExtensionName();
  if (!name) return;
  setTimeout(() => ctx.ui.setTitle(`π - ${name}`), 150);
}

// ── Theme ──────────────────────────────────────────────────────────────────

/**
 * Apply the persistent theme for an extension on session boot.
 * Loads theme from settings.json, defaults to synthwave if not set.
 * Persists successful theme applications to settings.json.
 *
 * @param fileUrl   Pass `import.meta.url` from the calling extension file.
 * @param ctx       The ExtensionContext from the session_start handler.
 * @returns         true if the theme was applied successfully, false otherwise.
 */
export function applyExtensionTheme(fileUrl: string, ctx: ExtensionContext): boolean {
  if (!ctx.hasUI) return false;

  // Load theme from settings, default to synthwave
  const settings = loadSettings();
  const themeName = settings.theme || DEFAULT_THEME;

  const result = ctx.ui.setTheme(themeName);

  // If theme was set successfully, ensure it's persisted
  if (result.success && settings.theme !== themeName) {
    settings.theme = themeName;
    saveSettings(settings);
  }

  // Fallback to synthwave if requested theme failed
  if (!result.success && themeName !== DEFAULT_THEME) {
    const fallback = ctx.ui.setTheme(DEFAULT_THEME);
    if (fallback.success) {
      settings.theme = DEFAULT_THEME;
      saveSettings(settings);
    }
    return fallback.success;
  }

  return result.success;
}

// ── Combined default ───────────────────────────────────────────────────────

/**
 * Apply both the persistent theme AND the terminal title for an extension.
 * Drop-in replacement for applyExtensionTheme — call this in every session_start.
 *
 * Usage:
 *   import { applyExtensionDefaults } from "./themeMap.ts";
 *
 *   pi.on("session_start", async (_event, ctx) => {
 *     applyExtensionDefaults(import.meta.url, ctx);
 *     // ... rest of handler
 *   });
 */
export function applyExtensionDefaults(fileUrl: string, ctx: ExtensionContext): void {
  applyExtensionTheme(fileUrl, ctx);
  applyExtensionTitle(ctx);
}