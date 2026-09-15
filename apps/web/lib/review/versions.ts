import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { publications } from "../db/schema";
import type { PublicationRow } from "../publications";

/**
 * The version stack behind the switcher (§ media spec Q8, decision C-3). A
 * `group_slug` is what makes v1 and v2 the same material rather than two
 * unrelated renders, so the switcher lists exactly the finalized, unrevoked
 * media rows sharing one — oldest first, which is the order the labels were
 * minted in and the order a reviewer thinks of them.
 *
 * A publication with no group is its own stack of one: the switcher does not
 * render, and its link opens nothing else.
 */

export interface VersionEntry {
  id: string;
  label: string | null;
  title: string;
  createdAt: string;
  /** True for the publication currently being reviewed. */
  current: boolean;
}

/** Every reviewable sibling of a publication, including itself. */
export function listGroupVersions(row: PublicationRow): PublicationRow[] {
  if (!row.groupSlug) return [row];
  const db = getDb();
  return db
    .select()
    .from(publications)
    .where(
      and(
        eq(publications.kind, "media"),
        eq(publications.groupSlug, row.groupSlug),
        isNotNull(publications.finalizedAt),
        isNull(publications.revokedAt),
      ),
    )
    .orderBy(asc(publications.createdAt))
    .all() as PublicationRow[];
}

/** The switcher's entries for one publication's group. */
export function toVersionEntries(rows: PublicationRow[], currentId: string): VersionEntry[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    title: row.title,
    createdAt: row.createdAt,
    current: row.id === currentId,
  }));
}
