import type {
  ChoiceOption,
  ChoiceSelect,
  Comment as SpecComment,
  Frontmatter,
  Item as SpecItem,
  ItemType,
  ResponseValue,
} from "@waypoint/spec";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "./db/client";
import { comments, documents, items, projects, responses } from "./db/schema";

/**
 * Document lifecycle. `archived` is not in the §6 status vocabulary the reviewer
 * sees — it is the internal state a document enters when a newer push supersedes
 * it (§6 "the old one auto-archives"). The queue hides archived docs by default.
 */
export const DOCUMENT_STATUSES = [
  "pending",
  "in_review",
  "completed",
  "pulled",
  "archived",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** A choice item's persisted config (mirrors the parser's shape). */
export interface ItemConfig {
  select?: ChoiceSelect;
  options?: Array<Pick<ChoiceOption, "label" | "checked">>;
}

/** One item ready to persist, derived from a parsed {@link SpecItem}. */
export interface PersistItem {
  wpId: string | null;
  type: ItemType;
  config: ItemConfig | null;
  promptMd: string | null;
  orderIndex: number;
  spanStart: number;
  spanEnd: number;
}

/** Map parsed spec items to rows for the `items` table. */
export function toPersistItems(specItems: SpecItem[]): PersistItem[] {
  return specItems.map((item, index) => ({
    wpId: item.wpId || null,
    type: item.type,
    config:
      item.type === "choice"
        ? {
            select: item.select ?? "single",
            options: (item.options ?? []).map((o) => ({ label: o.label, checked: o.checked })),
          }
        : null,
    promptMd: item.promptMd,
    orderIndex: index,
    spanStart: item.spans.block.start,
    spanEnd: item.spans.block.end,
  }));
}

export interface CreateDocumentInput {
  rawMd: string;
  title: string | null;
  frontmatter: Frontmatter;
  sourceType: string;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  pushedFromHost?: string | null;
  specVersion?: string | null;
  projectId?: string | null;
  items: PersistItem[];
}

export interface DocumentRow {
  id: string;
  projectId: string | null;
  title: string | null;
  rawMd: string;
  frontmatter: Frontmatter | null;
  sourceType: string;
  sourcePath: string | null;
  sourceUrl: string | null;
  pushedFromHost: string | null;
  specVersion: string | null;
  status: string;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persist a new document and its items in one transaction. If a prior,
 * non-archived document shares the same `project_id` + `source_path`, the new
 * row records it in `supersedes_id` and the prior row is archived — `raw_md`
 * is never mutated (§6 invariant). Returns the new document id.
 */
export function createDocument(input: CreateDocumentInput): string {
  const db = getDb();
  return db.transaction((tx) => {
    let supersedesId: string | null = null;
    if (input.projectId && input.sourcePath) {
      // Supersede the most recent live (non-archived) document for this source.
      const livePrior = tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.projectId, input.projectId),
            eq(documents.sourcePath, input.sourcePath),
            ne(documents.status, "archived"),
          ),
        )
        .orderBy(desc(documents.createdAt))
        .get();
      if (livePrior) {
        supersedesId = livePrior.id;
        tx
          .update(documents)
          .set({ status: "archived", updatedAt: new Date().toISOString() })
          .where(eq(documents.id, livePrior.id))
          .run();
      }
    }

    const [inserted] = tx
      .insert(documents)
      .values({
        projectId: input.projectId ?? null,
        title: input.title,
        rawMd: input.rawMd,
        frontmatter: input.frontmatter,
        sourceType: input.sourceType,
        sourcePath: input.sourcePath ?? null,
        sourceUrl: input.sourceUrl ?? null,
        pushedFromHost: input.pushedFromHost ?? null,
        specVersion: input.specVersion ?? null,
        status: "pending",
        supersedesId,
      })
      .returning({ id: documents.id })
      .all();

    if (input.items.length > 0) {
      tx
        .insert(items)
        .values(
          input.items.map((it) => ({
            documentId: inserted.id,
            wpId: it.wpId,
            type: it.type,
            config: it.config,
            promptMd: it.promptMd,
            synthetic: false,
            anchor: null,
            orderIndex: it.orderIndex,
            spanStart: it.spanStart,
            spanEnd: it.spanEnd,
          })),
        )
        .run();
    }

    return inserted.id;
  });
}

export interface ListDocumentsFilter {
  status?: string;
  projectId?: string;
  /** Include archived (superseded) documents. Default false. */
  includeArchived?: boolean;
}

export interface DocumentSummary {
  id: string;
  title: string | null;
  status: string;
  sourceType: string;
  projectId: string | null;
  projectName: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Queue listing, newest first, filtered by status and/or project (§8). */
export function listDocuments(filter: ListDocumentsFilter = {}): DocumentSummary[] {
  const db = getDb();
  const conditions = [];
  if (filter.status) conditions.push(eq(documents.status, filter.status));
  if (filter.projectId) conditions.push(eq(documents.projectId, filter.projectId));
  if (!filter.includeArchived && filter.status !== "archived") {
    // drizzle has no `ne` import here; express "not archived" via a raw compare.
    conditions.push(ne(documents.status, "archived"));
  }

  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      sourceType: documents.sourceType,
      projectId: documents.projectId,
      projectName: projects.name,
      supersedesId: documents.supersedesId,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(documents.createdAt))
    .all();

  return rows;
}

export interface ItemDetail {
  id: string;
  wpId: string | null;
  type: string;
  config: ItemConfig | null;
  promptMd: string | null;
  synthetic: boolean;
  orderIndex: number;
  response: { value: ResponseValue | null; status: string | null; updatedAt: string } | null;
}

export interface CommentDetail {
  id: string;
  anchor: SpecComment["anchor"];
  bodyMd: string;
  suggestionMd: string | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentRow {
  projectName: string | null;
  items: ItemDetail[];
  comments: CommentDetail[];
}

/** Full document with items, their responses, and comments (§8). Null if absent. */
export function getDocumentDetail(id: string): DocumentDetail | null {
  const db = getDb();
  const doc = db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  if (!doc) return null;

  const project = doc.projectId
    ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, doc.projectId)).get()
    : null;

  const itemRows = db
    .select()
    .from(items)
    .where(eq(items.documentId, id))
    .orderBy(items.orderIndex)
    .all();

  // Scope the responses query to this document's items — never load the whole
  // responses table (it grows with every reviewer answer across all docs).
  const itemIds = itemRows.map((it) => it.id);
  const responseRows =
    itemIds.length > 0
      ? db.select().from(responses).where(inArray(responses.itemId, itemIds)).all()
      : [];
  const responseByItem = new Map(responseRows.map((r) => [r.itemId, r]));

  const commentRows = db
    .select()
    .from(comments)
    .where(eq(comments.documentId, id))
    .all();

  return {
    ...(doc as DocumentRow),
    projectName: project?.name ?? null,
    items: itemRows.map((it) => {
      const r = responseByItem.get(it.id);
      return {
        id: it.id,
        wpId: it.wpId,
        type: it.type,
        config: it.config as ItemConfig | null,
        promptMd: it.promptMd,
        synthetic: it.synthetic,
        orderIndex: it.orderIndex,
        response: r
          ? { value: r.value as ResponseValue | null, status: r.status, updatedAt: r.updatedAt }
          : null,
      };
    }),
    comments: commentRows.map((c) => ({
      id: c.id,
      anchor: c.anchor as SpecComment["anchor"],
      bodyMd: c.bodyMd,
      suggestionMd: c.suggestionMd,
      createdAt: c.createdAt,
    })),
  };
}

export interface UpdateDocumentPatch {
  status?: DocumentStatus;
  projectId?: string | null;
}

/** Apply a status transition and/or project reassignment (§8). Null if absent. */
export function updateDocument(id: string, patch: UpdateDocumentPatch): DocumentRow | null {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.projectId !== undefined) set.projectId = patch.projectId;

  const [row] = db.update(documents).set(set).where(eq(documents.id, id)).returning().all();
  return (row as DocumentRow) ?? null;
}
