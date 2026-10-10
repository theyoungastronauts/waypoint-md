import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { voiceBriefs } from "@/lib/db/schema";
import type { VoiceBrief } from "./brief";

/** A stored brief and how it was made. */
export interface StoredBrief {
  brief: VoiceBrief;
  model: string;
  createdAt: string;
}

/** The cached brief for this document version, or null when none has been made. */
export function getCachedBrief(documentId: string, cacheKey: string): StoredBrief | null {
  const row = getDb()
    .select()
    .from(voiceBriefs)
    .where(and(eq(voiceBriefs.documentId, documentId), eq(voiceBriefs.cacheKey, cacheKey)))
    .get();
  if (!row) return null;
  return { brief: row.brief as VoiceBrief, model: row.model, createdAt: row.createdAt };
}

/**
 * Store a freshly made brief. Two Talk presses can race to make the same brief;
 * the unique (document, key) index makes the second insert a no-op, and both
 * callers then return whichever row landed first.
 */
export function saveBrief(
  documentId: string,
  cacheKey: string,
  model: string,
  brief: VoiceBrief,
): StoredBrief {
  getDb()
    .insert(voiceBriefs)
    .values({ documentId, cacheKey, model, brief })
    .onConflictDoNothing()
    .run();
  const stored = getCachedBrief(documentId, cacheKey);
  if (!stored) throw new Error(`voice brief for ${documentId} was not persisted`);
  return stored;
}
