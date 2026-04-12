/**
 * Run Script Extension
 *
 * Provides a tool and command to run TypeScript or JavaScript files using Bun.
 *
 * Usage:
 * - LLM can call the `run-script` tool with a filePath argument
 * - Users can use `/run <filePath>` command
 *
 * Examples:
 * - /run script.ts
 * - /run ./scripts/my-script.js
 */

import { spawn } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const RunScriptParams = Type.Object({
	filePath: Type.String({
		description: "The path to the script file to run (relative to workspace root or absolute)",
	}),
});

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Convert a Node.js stream to string
 */
function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		stream.on("data", (chunk) => chunks.push(chunk.toString()));
		stream.on("end", () => resolve(chunks.join("")));
		stream.on("error", reject);
	});
}

/**
 * Execute a script file using Bun
 * Uses NODE_PATH to find node_modules from ~/.pi/agent
 */
async function runScript(filePath: string): Promise<RunResult> {
	return new Promise((resolve) => {
		// Use NODE_PATH to include ~/.pi/agent/node_modules
		const agentDir = `${process.env.HOME}/.pi/agent`;
		const nodeModulesPath = `${agentDir}/node_modules`;
		
		const proc = spawn("bun", [filePath], {
			env: {
				...process.env,
				NODE_PATH: nodeModulesPath,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdoutPromise = streamToString(proc.stdout!);
		const stderrPromise = streamToString(proc.stderr!);

		proc.on("close", (exitCode) => {
			Promise.all([stdoutPromise, stderrPromise]).then(([stdout, stderr]) => {
				resolve({
					stdout,
					stderr,
					exitCode: exitCode ?? 0,
				});
			});
		});

		proc.on("error", () => {
			Promise.all([stdoutPromise, stderrPromise]).then(([stdout, stderr]) => {
				resolve({
					stdout,
					stderr,
					exitCode: 1,
				});
			});
		});
	});
}

export default function (pi: ExtensionAPI) {
	// Register the run-script tool for the LLM
	pi.registerTool({
		name: "run-script",
		label: "Run Script",
		description: "Run a TypeScript or JavaScript file using Bun. Executes the file and returns stdout, stderr, and exit code.",
		parameters: RunScriptParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext): Promise<{
			content: { type: "text"; text: string }[];
			details: RunResult;
		}> {
			const workspaceRoot = ctx.cwd;
			const resolvedPath = path.resolve(workspaceRoot, params.filePath);

			const result = await runScript(resolvedPath);

			let output = "";
			if (result.stdout) output += `STDOUT:\n${result.stdout}\n`;
			if (result.stderr) output += `STDERR:\n${result.stderr}\n`;
			output += `Exit code: ${result.exitCode}`;

			return {
				content: [{ type: "text", text: output }],
				details: result,
			};
		},

		renderCall(args, theme, _context) {
			const text =
				theme.fg("toolTitle", theme.bold("run-script ")) +
				theme.fg("dim", args.filePath);
			return new Text(text, 0, 0);
		},

		renderResult(result, _expanded, theme, _context) {
			const details = result.details as RunResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];

			if (details.stdout) {
				lines.push(theme.fg("muted", "STDOUT:"));
				for (const line of details.stdout.split("\n").slice(0, 10)) {
					lines.push(theme.fg("text", "  " + line));
				}
				if (details.stdout.split("\n").length > 10) {
					lines.push(theme.fg("dim", "  ..."));
				}
			}

			if (details.stderr) {
				lines.push(theme.fg("error", "STDERR:"));
				for (const line of details.stderr.split("\n").slice(0, 10)) {
					lines.push(theme.fg("error", "  " + line));
				}
				if (details.stderr.split("\n").length > 10) {
					lines.push(theme.fg("dim", "  ..."));
				}
			}

			const status = details.exitCode === 0
				? theme.fg("success", `✓ Exit code: ${details.exitCode}`)
				: theme.fg("error", `✗ Exit code: ${details.exitCode}`);
			lines.push(status);

			return new Text(lines.join("\n"), 0, 0);
		},
	});

	// Register /run command for users
	pi.registerCommand("run", {
		description: "Run a TypeScript or JavaScript file using Bun",
		handler: async (args, ctx: ExtensionContext) => {
			if (!args || args.length === 0) {
				ctx.ui.notify("Usage: /run <filePath>", "error");
				return;
			}

			const filePath = args[0];
			const workspaceRoot = ctx.cwd;
			const resolvedPath = path.resolve(workspaceRoot, filePath);

			ctx.ui.notify(`Running ${resolvedPath}...`, "info");

			const result = await runScript(resolvedPath);

			let message = "";
			if (result.stdout) message += `STDOUT:\n${result.stdout}\n`;
			if (result.stderr) message += `STDERR:\n${result.stderr}\n`;
			message += `Exit code: ${result.exitCode}`;

			const status = result.exitCode === 0 ? "success" : "error";
			ctx.ui.notify(message, status);
		},
	});
}
