import { watch } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

let watchers: ReturnType<typeof watch>[] = [];

export function startWatch(
  ctx: ExtensionContext,
  targetPath: string,
  onChange: () => void
): void {
  // Stop existing watchers
  stopWatch();
  
  ctx.ui.notify(` Watching ${targetPath}...`, "info");
  
  // Watch directories for changes
  const watcher = watch(targetPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    
    // Only watch relevant file types
    const relevant = ['.ts', '.js', '.py', '.md', '.json'].some(ext => 
      filename.endsWith(ext)
    );
    
    if (relevant && !filename.includes('graphify-out')) {
      ctx.ui.notify(` Change detected: ${filename}`, "info");
      onChange();
    }
  });
  
  watchers.push(watcher);
}

export function stopWatch(): void {
  for (const w of watchers) {
    w.close();
  }
  watchers = [];
}
