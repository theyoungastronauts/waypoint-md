import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documents, items } from "@/lib/db/schema";

/**
 * Phone PINs (Waypoint Voice, phone): a 4-digit code that opens one review over
 * the phone. Decisions Q4/Q7: every document with questions gets one, and only
 * live reviews answer to it — once a review is completed, pulled or superseded
 * its PIN stops working and may be handed to a new review.
 *
 * PINs run 1000–9999: none starts with 0, because pressing 0 in the lobby means
 * "the latest review" (Q8). With few live reviews at a time, collisions are rare
 * and resolved by drawing again.
 */

export const LIVE_STATUSES = ["pending", "in_review"] as const;
const PIN_MIN = 1000;
const PIN_MAX = 9999;
const MAX_DRAWS = 200;

export function isValidPin(pin: string): boolean {
  return /^[1-9]\d{3}$/.test(pin);
}

/**
 * The document's PIN, assigning one if it is a live review with questions and
 * has none yet. Returns null for a finished review or one without questions.
 */
export function ensurePhonePin(documentId: string): string | null {
  const db = getDb();
  return db.transaction((tx) => {
    const doc = tx
      .select({ status: documents.status, phonePin: documents.phonePin })
      .from(documents)
      .where(eq(documents.id, documentId))
      .get();
    if (!doc || !(LIVE_STATUSES as readonly string[]).includes(doc.status)) return null;
    if (doc.phonePin) return doc.phonePin;

    const hasItems = tx.select({ id: items.id }).from(items).where(eq(items.documentId, documentId)).get();
    if (!hasItems) return null;

    for (let draw = 0; draw < MAX_DRAWS; draw++) {
      const pin = String(randomInt(PIN_MIN, PIN_MAX + 1));
      const holder = tx
        .select({ id: documents.id, status: documents.status })
        .from(documents)
        .where(eq(documents.phonePin, pin))
        .get();
      if (holder && (LIVE_STATUSES as readonly string[]).includes(holder.status)) continue;
      // A finished review's PIN is free to reuse; take it off the old one first.
      if (holder) tx.update(documents).set({ phonePin: null }).where(eq(documents.id, holder.id)).run();
      tx.update(documents).set({ phonePin: pin }).where(eq(documents.id, documentId)).run();
      return pin;
    }
    throw new Error("could not find a free phone PIN");
  });
}

/** Give every live review with questions a PIN. Run at boot; returns how many were assigned. */
export function backfillPhonePins(): number {
  const db = getDb();
  const candidates = db
    .selectDistinct({ id: documents.id })
    .from(documents)
    .innerJoin(items, eq(items.documentId, documents.id))
    .where(and(inArray(documents.status, [...LIVE_STATUSES]), isNull(documents.phonePin)))
    .all();
  let assigned = 0;
  for (const { id } of candidates) {
    if (ensurePhonePin(id)) assigned++;
  }
  return assigned;
}

export interface PhoneDocument {
  id: string;
  title: string | null;
}

/** The live review a PIN opens, or null. A finished review's PIN opens nothing. */
export function findLiveDocumentByPin(pin: string): PhoneDocument | null {
  if (!isValidPin(pin)) return null;
  const row = getDb()
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(eq(documents.phonePin, pin), inArray(documents.status, [...LIVE_STATUSES])))
    .get();
  return row ?? null;
}

/** The most recently pushed live review with questions (the "latest" shortcut). */
export function findLatestLiveDocument(): PhoneDocument | null {
  const row = getDb()
    .selectDistinct({ id: documents.id, title: documents.title, createdAt: documents.createdAt })
    .from(documents)
    .innerJoin(items, eq(items.documentId, documents.id))
    .where(inArray(documents.status, [...LIVE_STATUSES]))
    .orderBy(desc(documents.createdAt))
    .get();
  return row ? { id: row.id, title: row.title } : null;
}
