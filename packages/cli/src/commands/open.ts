import { spawn } from "node:child_process";

import type { ResolvedConfig } from "../config";
import { CliError } from "../io";
import { readPointer } from "../pointer";
import type { CommandDeps } from "./push";

/** Absolute review URL for a document id. */
export function reviewUrl(config: ResolvedConfig, id: string): string {
  return `${config.publicUrl}/d/${id}`;
}

/** Platform command to open a URL in the default browser. */
function openCommand(url: string): { cmd: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { cmd: "open", args: [url] };
    case "win32":
      return { cmd: "cmd", args: ["/c", "start", "", url] };
    default:
      return { cmd: "xdg-open", args: [url] };
  }
}

/**
 * `waypoint open [id]` (§12): resolve the id (explicit or the pending pointer)
 * and open its review URL in a browser. The URL is always printed so it works
 * headless too.
 */
export async function runOpen(idArg: string | undefined, deps: CommandDeps): Promise<void> {
  const { config, io } = deps;
  const id = idArg ?? readPointer(config.projectRoot)?.id;
  if (!id) {
    throw new CliError("No document to open. Specify an id, or push one first.");
  }
  const url = reviewUrl(config, id);
  io.log(url);
  const { cmd, args } = openCommand(url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* headless / no browser — the URL was already printed. */
    });
    child.unref();
  } catch {
    /* swallow — printing the URL is the reliable fallback. */
  }
}
