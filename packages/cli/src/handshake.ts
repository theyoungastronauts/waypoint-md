import { health } from "./client";
import type { ResolvedConfig } from "./config";
import type { IO } from "./io";

/**
 * The spec version this CLI is built against. The health handshake compares
 * major versions and warns on a mismatch (§12) — a different major means the
 * server may emit a convention this CLI doesn't understand.
 */
export const EXPECTED_SPEC_VERSION = "1.0.0";

function major(version: string): string {
  return version.split(".")[0] ?? version;
}

/**
 * Best-effort health handshake (§12): reachable + matching major → silent;
 * reachable + mismatched major → warn; unreachable → silent (push falls back to
 * the outbox, other commands surface their own network error). Never throws.
 */
export async function handshake(config: ResolvedConfig, io: IO): Promise<void> {
  try {
    const info = await health(config);
    if (major(info.specVersion) !== major(EXPECTED_SPEC_VERSION)) {
      io.warn(
        `Warning: server spec version ${info.specVersion} differs from this CLI's ${EXPECTED_SPEC_VERSION}; ` +
          `output may not round-trip cleanly.`,
      );
    }
  } catch {
    // Advisory only — swallow. The command itself decides how to handle a down
    // server (push queues; status/pull report the network error).
  }
}
