import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export async function copyToObsidian(
  sourcePath: string,
  obsidianDir: string,
  ctx: ExtensionContext
): Promise<void> {
  const sourceDir = join(sourcePath, "graphify-out");
  const targetDir = join(obsidianDir, "graphify");
  
  mkdirSync(targetDir, { recursive: true });
  
  // Copy key files
  const filesToCopy = [
    "GRAPH_REPORT.md",
    "graph.html",
    "graph.json"
  ];
  
  for (const file of filesToCopy) {
    const src = join(sourceDir, file);
    const dst = join(targetDir, file);
    try {
      copyFileSync(src, dst);
      ctx.ui.notify(`  Copied ${file}`, "info");
    } catch {
      ctx.ui.notify(`  Skipped ${file} (not found)`, "warning");
    }
  }
  
  // Copy wiki if exists
  const wikiSource = join(sourceDir, "wiki");
  const wikiTarget = join(targetDir, "wiki");
  try {
    copyRecursive(wikiSource, wikiTarget);
    ctx.ui.notify(`  Copied wiki/`, "info");
  } catch {
    // Wiki may not exist
  }
  
  ctx.ui.notify(`Obsidian vault updated: ${targetDir}`, "info");
}

function copyRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    
    if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}
