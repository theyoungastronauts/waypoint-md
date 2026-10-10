import type { TranscriptEntry } from "./transcript";

/**
 * Saves a call's transcript as it goes (Waypoint Voice): entries are batched and
 * PATCHed to `/api/voice-sessions/:id` every few seconds, so a dropped call or a
 * closed tab keeps everything up to the last batch. The final flush carries the
 * call's end status and uses `keepalive` so it survives the page unloading.
 *
 * A failed batch is put back at the front of the queue and retried with the
 * next one. Only a failure of the very last flush loses entries, and that is
 * logged.
 */
export const FLUSH_INTERVAL_MS = 3_000;
const MAX_BATCH = 200;
/** Browsers refuse `keepalive` bodies over 64 KiB; stay under it. */
const KEEPALIVE_MAX_CHARS = 60_000;

export class TranscriptSync {
  private readonly sessionId: string;
  private readonly fetchImpl: typeof fetch;
  private queue: TranscriptEntry[] = [];
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(sessionId: string, fetchImpl: typeof fetch) {
    this.sessionId = sessionId;
    this.fetchImpl = fetchImpl;
  }

  /** Start periodic flushing. */
  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  push(entry: TranscriptEntry): void {
    if (this.closed) return;
    this.queue.push(entry);
  }

  /** Record the reviewer's brief/thorough choice right away. */
  setMode(mode: "brief" | "thorough"): Promise<void> {
    return this.send({ mode });
  }

  /** Send whatever is queued. Resolves once that batch has landed or failed. */
  async flush(extra: { status?: "ended" | "submitted" } = {}, keepalive = false): Promise<void> {
    if (this.inFlight) await this.inFlight;
    const batch = this.queue.splice(0, MAX_BATCH);
    if (batch.length === 0 && !extra.status) return;
    this.inFlight = this.send({ ...extra, ...(batch.length > 0 ? { append: batch } : {}) }, keepalive, batch);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    if (this.queue.length > 0 && extra.status === undefined && batch.length === MAX_BATCH) {
      await this.flush();
    }
  }

  /** Final flush with the end status; stops the timer. Safe to call twice. */
  async close(status: "ended" | "submitted"): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.closed) return;
    this.closed = true;
    // Drain everything, the last batch carrying the status.
    while (this.queue.length > MAX_BATCH) await this.flush();
    await this.flush({ status }, true);
  }

  private async send(
    body: Record<string, unknown>,
    keepalive = false,
    batch: TranscriptEntry[] = [],
  ): Promise<void> {
    const json = JSON.stringify(body);
    try {
      const res = await this.fetchImpl(`/api/voice-sessions/${this.sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: json,
        keepalive: keepalive && json.length <= KEEPALIVE_MAX_CHARS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[voice] transcript save failed (${err instanceof Error ? err.message : "error"}); will retry`);
      if (batch.length > 0) this.queue.unshift(...batch);
    }
  }
}
