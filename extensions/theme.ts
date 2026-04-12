/**
 * Theme & Welcome Extension - Combined theme cycling and welcome header
 *
 * Theme Features:
 *   Ctrl+X          — Cycle theme forward
 *   Ctrl+Q          — Cycle theme backward
 *   /theme          — Open select picker to choose a theme
 *   /theme <name>   — Switch directly by name
 *
 * Welcome Features:
 *   - Welcome header with logo, greeting, and tips
 *   - Shows cwd, theme, model info
 *   - Recent session messages
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { applyExtensionDefaults } from "../src/themeMap";

export default function (pi: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;
  let swatchTimer: ReturnType<typeof setTimeout> | null = null;

  // ============================================================================
  // Theme Cycling Functions
  // ============================================================================

  function updateStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const name = ctx.ui.theme.name;
    ctx.ui.setStatus("theme", `🎨 ${name}`);
  }

  function showSwatch(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    if (swatchTimer) {
      clearTimeout(swatchTimer);
      swatchTimer = null;
    }

    ctx.ui.setWidget(
      "theme-swatch",
      (_tui, theme) => ({
        invalidate() {},
        render(width: number): string[] {
          const block = "\u2588\u2588\u2588";
          const swatch =
            theme.fg("success", block) +
            " " +
            theme.fg("accent", block) +
            " " +
            theme.fg("warning", block) +
            " " +
            theme.fg("dim", block) +
            " " +
            theme.fg("muted", block);
          const label =
            theme.fg("accent", " 🎨 ") +
            (ctx.ui.theme.name ? theme.fg("muted", ctx.ui.theme.name) : "") +
            "  " +
            swatch;
          const border = theme.fg(
            "borderMuted",
            "─".repeat(Math.max(0, width)),
          );
          return [border, truncateToWidth("  " + label, width), border];
        },
      }),
      { placement: "belowEditor" },
    );

    swatchTimer = setTimeout(() => {
      ctx.ui.setWidget("theme-swatch", undefined);
      swatchTimer = null;
    }, 3000);
  }

  function getThemeList(ctx: ExtensionContext) {
    return ctx.ui.getAllThemes();
  }

  function findCurrentIndex(ctx: ExtensionContext): number {
    const themes = getThemeList(ctx);
    const current = ctx.ui.theme.name;
    return themes.findIndex((t) => t.name === current);
  }

  function cycleTheme(ctx: ExtensionContext, direction: 1 | -1) {
    if (!ctx.hasUI) return;

    const themes = getThemeList(ctx);
    if (themes.length === 0) {
      ctx.ui.notify("No themes available", "warning");
      return;
    }

    let index = findCurrentIndex(ctx);
    if (index === -1) index = 0;

    index = (index + direction + themes.length) % themes.length;
    const theme = themes[index];
    const result = ctx.ui.setTheme(theme.name);

    if (result.success) {
      updateStatus(ctx);
      showSwatch(ctx);
      ctx.ui.notify(`${theme.name} (${index + 1}/${themes.length})`, "info");
    } else {
      ctx.ui.notify(`Failed to set theme: ${result.error}`, "error");
    }
  }

  // ============================================================================
  // Welcome Header Functions
  // ============================================================================

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function buildLogo(theme: Theme): string[] {
    const left = (s: string) => theme.fg("thinkingHigh", s);
    const right = (s: string) => theme.fg("accent", s);
    const purple = (s: string) => theme.fg("thinkingMedium", s);

    return [
      ` ${left("██████")}${right("██████")}`,
      `   ${left("█")}${purple("█")}${left("█")}  ${right("█")}${purple("█")}${right("█")}`,
      `   ${left("█")}${purple("█")}${left("█")}  ${right("█")}${purple("█")}${right("█")}`,
      `   ${left("█")}${purple("█")}${left("█")}  ${right("█")}${purple("█")}${right("█")}`,
      `   ${left("█")}${purple("█")}${left("█")}  ${right("█")}${purple("█")}${right("█")}`,
      `   ${left("▀▀▀")}  ${right("▀▀▀")}`,
    ];
  }

  function padRight(text: string, width: number): string {
    return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
  }

  function makeLine(left: string, right: string, width: number): string {
    const inner = Math.max(0, width - 4);
    const gap = Math.max(1, inner - visibleWidth(left) - visibleWidth(right));
    return `│ ${truncateToWidth(left + " ".repeat(gap) + right, inner)} │`;
  }

  function getRecentSessionRows(ctx: ExtensionContext, theme: Theme): string[] {
    const sessions = ctx.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "message")
      .slice(-3)
      .map((entry) => {
        if (entry.type !== "message") return "";
        const role = entry.message.role;
        if (role === "user") {
          return (
            theme.fg("accent", "• ") +
            theme.fg("text", "user message") +
            theme.fg("dim", ` (${entry.id.slice(0, 6)})`)
          );
        }
        if (role === "assistant") {
          return (
            theme.fg("accent", "• ") +
            theme.fg("text", "assistant reply") +
            theme.fg("dim", ` (${entry.id.slice(0, 6)})`)
          );
        }
        return (
          theme.fg("accent", "• ") +
          theme.fg("muted", role) +
          theme.fg("dim", ` (${entry.id.slice(0, 6)})`)
        );
      })
      .filter(Boolean)
      .reverse();

    if (sessions.length === 0) {
      return [theme.fg("dim", "• no previous messages yet")];
    }

    return sessions;
  }

  function panel(theme: Theme, width: number, ctx: ExtensionContext): string[] {
    const cwd = ctx.cwd;
    const model = ctx.model?.id ?? "no model selected";
    if (width < 48) {
      return [
        truncateToWidth(
          theme.fg("accent", theme.bold(`${getGreeting()}!`)),
          width,
        ),
        truncateToWidth(
          theme.fg("muted", "welcome to pi • / for commands • ! for bash"),
          width,
        ),
      ];
    }

    const inner = Math.max(0, width - 2);
    const top = theme.fg(
      "borderAccent",
      `┌${"─".repeat(Math.max(0, inner - 2))}┐`,
    );
    const bottom = theme.fg(
      "borderAccent",
      `└${"─".repeat(Math.max(0, inner - 2))}┘`,
    );
    const divider = theme.fg("border", " │ ");
    const logo = buildLogo(theme);

    const leftWidth = Math.max(22, Math.floor((inner - 3) * 0.34));
    const rightWidth = Math.max(18, inner - leftWidth - 3);

    const leftRows = [
      theme.fg("text", theme.bold(`${getGreeting()}!`)),
      "",
      ...logo,
      "",
      theme.fg("muted", "welcome to pi!"),
      "",
    ];

    const rightRows = [
      theme.fg("warning", theme.bold("Tips")),
      theme.fg("muted", "/ ") + theme.fg("text", "for commands"),
      theme.fg("muted", "! ") + theme.fg("text", "to run bash"),
      theme.fg("muted", "Shift+Tab ") + theme.fg("text", "cycle thinking"),
      "",
      theme.fg("success", "Loaded"),
      theme.fg("success", "✓ ") + theme.fg("text", `cwd: ${cwd}`),
      theme.fg("success", "✓ ") + theme.fg("text", `theme: ${theme.name}`),
      theme.fg("success", "✓ ") + theme.fg("text", `model: ${model}`),
      "",
      theme.fg("accent", theme.bold("Recent session")),
      ...getRecentSessionRows(ctx, theme),
    ];

    const rowCount = Math.max(leftRows.length, rightRows.length);
    const lines: string[] = [top];

    for (let i = 0; i < rowCount; i++) {
      const left = padRight(
        truncateToWidth(leftRows[i] ?? "", leftWidth, ""),
        leftWidth,
      );
      const right = truncateToWidth(rightRows[i] ?? "", rightWidth, "");
      lines.push(makeLine(left + divider + right, "", inner));
    }

    lines.push(bottom);
    return lines;
  }

  function applyWelcomeHeader(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader((_tui: unknown, theme: Theme) => ({
      render(width: number): string[] {
        const targetWidth = Math.min(width, 100);
        return ["", ...panel(theme, targetWidth, ctx), ""];
      },
      invalidate() {},
    }));

    ctx.ui.setStatus("welcome", "✨ welcome-message active");
  }

  // ============================================================================
  // Shortcuts
  // ============================================================================

  pi.registerShortcut("ctrl+x", {
    description: "Cycle theme forward",
    handler: async (ctx) => {
      currentCtx = ctx;
      cycleTheme(ctx, 1);
    },
  });

  pi.registerShortcut("ctrl+q", {
    description: "Cycle theme backward",
    handler: async (ctx) => {
      currentCtx = ctx;
      cycleTheme(ctx, -1);
    },
  });

  // ============================================================================
  // Commands
  // ============================================================================

  pi.registerCommand("theme", {
    description: "Select a theme: /theme or /theme <name>",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      if (!ctx.hasUI) return;

      const themes = getThemeList(ctx);
      const arg = args.trim();

      if (arg) {
        const result = ctx.ui.setTheme(arg);
        if (result.success) {
          updateStatus(ctx);
          showSwatch(ctx);
          ctx.ui.notify(`Theme: ${arg}`, "info");
        } else {
          ctx.ui.notify(
            `Theme not found: ${arg}. Use /theme to see available themes.`,
            "error",
          );
        }
        return;
      }

      const items = themes.map((t) => {
        const desc = t.path ? t.path : "built-in";
        const active = t.name === ctx.ui.theme.name ? " (active)" : "";
        return `${t.name}${active}`;
      });

      const selected = await ctx.ui.select("Select Theme", items);
      if (!selected) return;

      const selectedName = selected.split(/\s/)[0];
      const result = ctx.ui.setTheme(selectedName);
      if (result.success) {
        updateStatus(ctx);
        showSwatch(ctx);
        ctx.ui.notify(`Theme: ${selectedName}`, "info");
      }
    },
  });

  // ============================================================================
  // Session Events
  // ============================================================================

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    applyExtensionDefaults(import.meta.url, ctx);
    updateStatus(ctx);
    applyWelcomeHeader(ctx);
  });

  pi.on("session_shutdown", async () => {
    if (swatchTimer) {
      clearTimeout(swatchTimer);
      swatchTimer = null;
    }
  });
}