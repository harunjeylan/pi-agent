import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getPythonDir } from "./utils.js";
import type { IngestOptions } from "./types.js";

export async function ingestUrl(
  ctx: ExtensionContext,
  python: string,
  url: string,
  targetPath: string,
  options: IngestOptions = {}
): Promise<string | null> {
  const rawDir = join(targetPath, "raw");
  mkdirSync(rawDir, { recursive: true });

  ctx.ui.notify(` Fetching ${url}...`, "info");

  const scriptPath = join(getPythonDir(), "..", "..", "..", "..", ".local", "lib", "python3.12", "site-packages", "graphify", "ingest.py");
  
  // Fallback: try to use graphify module directly
  const args = ["-m", "graphify.ingest", url, rawDir];
  
  if (options.author) {
    args.push("--author", options.author);
  }
  if (options.contributor) {
    args.push("--contributor", options.contributor);
  }

  return new Promise((resolve) => {
    const proc = spawn(python, args, { cwd: ctx.cwd });
    let output = "";
    let error = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.stderr?.on("data", (d) => (error += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        ctx.ui.notify(` Fetch failed: ${error}`, "error");
        resolve(null);
        return;
      }
      // Extract saved path from output
      const match = output.match(/Saved \w+: (.+\.md)/) || 
                    output.match(/Downloaded \w+: (.+)/);
      if (match) {
        resolve(match[1]);
      } else {
        resolve(rawDir);
      }
    });
  });
}
