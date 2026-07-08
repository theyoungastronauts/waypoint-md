import { asc, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { chatMessages } from "./db/schema";

/**
 * The document-scoped chat thread (§14: "one chat thread per document in v1").
 * Every turn is persisted in `chat_messages` so the sidebar survives a reload;
 * there is exactly one thread per document — no thread id, just the document.
 */

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

/** The whole thread for a document, oldest first. */
export function listChatMessages(documentId: string): ChatTurn[] {
  const rows = getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.documentId, documentId))
    .orderBy(asc(chatMessages.createdAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

/** Append one turn to a document's thread; returns the stored row. */
export function appendChatMessage(documentId: string, role: ChatRole, content: string): ChatTurn {
  const [row] = getDb()
    .insert(chatMessages)
    .values({ documentId, role, content })
    .returning()
    .all();
  return { id: row.id, role: row.role as ChatRole, content: row.content, createdAt: row.createdAt };
}
