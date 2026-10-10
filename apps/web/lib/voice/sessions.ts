import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { voiceSessions } from "@/lib/db/schema";
import { MAX_TRANSCRIPT_ENTRIES, type TranscriptEntry } from "./transcript";

export type VoiceSessionStatus = "active" | "ended" | "submitted";
export type VoiceStyle = "brief" | "thorough";

export interface VoiceSessionRow {
  id: string;
  documentId: string;
  model: string;
  mode: VoiceStyle | null;
  status: VoiceSessionStatus;
  transcript: TranscriptEntry[];
  startedAt: string;
  endedAt: string | null;
  submittedAt: string | null;
}

function toRow(row: typeof voiceSessions.$inferSelect): VoiceSessionRow {
  return {
    id: row.id,
    documentId: row.documentId,
    model: row.model,
    mode: (row.mode as VoiceStyle | null) ?? null,
    status: row.status as VoiceSessionStatus,
    transcript: (row.transcript as TranscriptEntry[] | null) ?? [],
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    submittedAt: row.submittedAt,
  };
}

/** Open a call record when its client key is minted. */
export function createVoiceSession(documentId: string, model: string): VoiceSessionRow {
  const row = getDb()
    .insert(voiceSessions)
    .values({ documentId, model, transcript: [] })
    .returning()
    .get();
  return toRow(row);
}

export function getVoiceSession(id: string): VoiceSessionRow | null {
  const row = getDb().select().from(voiceSessions).where(eq(voiceSessions.id, id)).get();
  return row ? toRow(row) : null;
}

/** Every call on a document, newest first. */
export function listVoiceSessions(documentId: string): VoiceSessionRow[] {
  return getDb()
    .select()
    .from(voiceSessions)
    .where(eq(voiceSessions.documentId, documentId))
    .orderBy(desc(voiceSessions.startedAt))
    .all()
    .map(toRow);
}

export interface VoiceSessionUpdate {
  append?: TranscriptEntry[];
  mode?: VoiceStyle;
  status?: "ended" | "submitted";
}

/**
 * Append transcript entries and record the style or the call's end. Appends
 * past the entry ceiling are dropped (logged), never an error — losing the tail
 * of a runaway transcript must not break the call. `submitted` is terminal: a
 * later `ended` (the browser hanging up after submit) does not overwrite it.
 */
export function updateVoiceSession(id: string, update: VoiceSessionUpdate): VoiceSessionRow | null {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(voiceSessions).where(eq(voiceSessions.id, id)).get();
    if (!row) return null;
    const current = toRow(row);
    const now = new Date().toISOString();

    let transcript = current.transcript;
    if (update.append && update.append.length > 0) {
      const room = MAX_TRANSCRIPT_ENTRIES - transcript.length;
      if (room < update.append.length) {
        console.warn(`[voice-session] ${id} transcript full; dropped ${update.append.length - Math.max(room, 0)} entries`);
      }
      transcript = [...transcript, ...update.append.slice(0, Math.max(room, 0))];
    }

    const patch: Partial<typeof voiceSessions.$inferInsert> = { transcript };
    if (update.mode) patch.mode = update.mode;
    if (update.status === "submitted") {
      patch.status = "submitted";
      patch.submittedAt = current.submittedAt ?? now;
      patch.endedAt = current.endedAt ?? now;
    } else if (update.status === "ended" && current.status !== "submitted") {
      patch.status = "ended";
      patch.endedAt = current.endedAt ?? now;
    } else if (update.status === "ended") {
      patch.endedAt = current.endedAt ?? now;
    }

    const updated = tx.update(voiceSessions).set(patch).where(eq(voiceSessions.id, id)).returning().get();
    return toRow(updated);
  });
}
