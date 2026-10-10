import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the migration bootstrap directly (the same drizzle folder the app
 * runs on boot): a fresh SQLite file must come up with the seven §6 tables plus
 * the publish feature's `publications` table and its FTS5 index + sync triggers.
 */
const EXPECTED_TABLES = [
  "projects",
  "documents",
  "items",
  "responses",
  "comments",
  "chat_messages",
  "settings",
  "publications",
  "attachments",
  "review_links",
  "media_comments",
  "voice_briefs",
  "voice_sessions",
];

const EXPECTED_TRIGGERS = ["publications_fts_ai", "publications_fts_ad", "publications_fts_au"];

const migrationsFolder = path.join(import.meta.dirname, "..", "..", "..", "drizzle");

describe("database migrations", () => {
  let dir: string;
  let db: Database.Database;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "waypoint-migrate-"));
    db = new Database(path.join(dir, "waypoint.db"));
    db.pragma("journal_mode = WAL");
    migrate(drizzle(db), { migrationsFolder });
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the core tables plus publications on a fresh boot", () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);

    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("creates the publications FTS index and its content-sync triggers", () => {
    const ftsRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publications_fts'")
      .all() as Array<{ name: string }>;
    expect(ftsRows).toHaveLength(1);

    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all() as Array<{ name: string }>;
    const names = triggers.map((t) => t.name);
    for (const trigger of EXPECTED_TRIGGERS) {
      expect(names).toContain(trigger);
    }
  });
});

/**
 * Migration 0003 (media publications) rewrites the FTS5 index from
 * `(title, source_md)` to `(title, source_md, search_text)` — it drops and
 * recreates the virtual table and its three triggers, then rebuilds. That is the
 * one migration in the set that touches data already on disk, so it is exercised
 * against a database migrated to the *previous* revision and carrying a row:
 * apply 0000–0002, write a markdown publication, then apply 0003 and assert the
 * row survived, defaulted to `kind = 'markdown'`, and is still searchable.
 */
describe("migration 0003 — media columns and the rebuilt FTS index", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  /** A copy of the drizzle folder holding only migrations up to `throughTag`. */
  function migrationsThrough(throughTag: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "waypoint-migrate-partial-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(migrationsFolder, dir, { recursive: true });

    const journalPath = path.join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const cut = journal.entries.findIndex((e) => e.tag === throughTag);
    expect(cut).toBeGreaterThanOrEqual(0);
    for (const entry of journal.entries.slice(cut + 1)) {
      rmSync(path.join(dir, `${entry.tag}.sql`), { force: true });
    }
    journal.entries = journal.entries.slice(0, cut + 1);
    writeFileSync(journalPath, JSON.stringify(journal, null, 2), "utf8");
    return dir;
  }

  function openAtRevision(throughTag: string): Database.Database {
    const dir = mkdtempSync(path.join(tmpdir(), "waypoint-migrate-0003-"));
    const db = new Database(path.join(dir, "waypoint.db"));
    cleanups.push(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    db.pragma("journal_mode = WAL");
    migrate(drizzle(db), { migrationsFolder: migrationsThrough(throughTag) });
    return db;
  }

  it("keeps an existing markdown row, defaults its kind, and re-indexes it", () => {
    const db = openAtRevision("0002_glorious_plazm");
    db.prepare(
      `INSERT INTO publications (id, title, sanitized_name, source_md, r2_folder, public_base, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "legacy-1",
      "Legacy Plan",
      "legacy-plan",
      "# Legacy Plan\n\nthe pelican beat",
      "smitty/shares/legacy-1",
      "dropzone.tylersavery.com",
      "cli",
      "2026-01-01T00:00:00.000Z",
    );

    migrate(drizzle(db), { migrationsFolder });

    const row = db.prepare("SELECT * FROM publications WHERE id = 'legacy-1'").get() as Record<
      string,
      unknown
    >;
    expect(row.title).toBe("Legacy Plan");
    expect(row.source_md).toBe("# Legacy Plan\n\nthe pelican beat");
    expect(row.kind).toBe("markdown");
    expect(row.search_text).toBe("");
    expect(row.finalized_at).toBeNull();

    // The rebuild re-indexed the pre-existing row under the new three-column shape.
    const hits = db
      .prepare("SELECT rowid FROM publications_fts WHERE publications_fts MATCH 'pelican'")
      .all();
    expect(hits).toHaveLength(1);
  });

  it("indexes a media row by its search_text, with no source markdown", () => {
    const db = openAtRevision("0002_glorious_plazm");
    migrate(drizzle(db), { migrationsFolder });

    db.prepare(
      `INSERT INTO publications
         (id, title, sanitized_name, source_md, kind, content_type, group_slug, label, search_text,
          r2_folder, public_base, origin, created_at)
       VALUES (?, ?, ?, '', 'media', 'video/mp4', ?, ?, ?, ?, ?, 'cli', ?)`,
    ).run(
      "media-1",
      "vBTC Unwrapped v2",
      "vbtc-unwrapped-v2",
      "vbtc-unwrapped",
      "v2",
      "vbtc-unwrapped v2 wordmark-reveal prores",
      "smitty/shares/media-1",
      "dropzone.tylersavery.com",
      "2026-02-01T00:00:00.000Z",
    );

    const byGroup = db
      .prepare(
        "SELECT p.id AS id FROM publications_fts f JOIN publications p ON p.rowid = f.rowid WHERE publications_fts MATCH 'vbtc'",
      )
      .all() as Array<{ id: string }>;
    expect(byGroup.map((r) => r.id)).toContain("media-1");

    const byComposition = db
      .prepare(
        "SELECT p.id AS id FROM publications_fts f JOIN publications p ON p.rowid = f.rowid WHERE publications_fts MATCH 'prores'",
      )
      .all() as Array<{ id: string }>;
    expect(byComposition.map((r) => r.id)).toEqual(["media-1"]);
  });

  it("keeps the index in sync when a media row is updated or deleted", () => {
    const db = openAtRevision("0002_glorious_plazm");
    migrate(drizzle(db), { migrationsFolder });

    db.prepare(
      `INSERT INTO publications
         (id, title, sanitized_name, source_md, kind, search_text, r2_folder, public_base, origin, created_at)
       VALUES ('m2', 'Still', 'still', '', 'media', 'heron', 'smitty/shares/m2', 'd.example', 'cli', '2026-02-02T00:00:00.000Z')`,
    ).run();

    const matches = (term: string) =>
      (
        db
          .prepare("SELECT rowid FROM publications_fts WHERE publications_fts MATCH ?")
          .all(term) as unknown[]
      ).length;

    expect(matches("heron")).toBe(1);

    db.prepare("UPDATE publications SET search_text = 'egret' WHERE id = 'm2'").run();
    expect(matches("heron")).toBe(0);
    expect(matches("egret")).toBe(1);

    db.prepare("DELETE FROM publications WHERE id = 'm2'").run();
    expect(matches("egret")).toBe(0);
  });
});

/**
 * Migration 0004 (public video review) adds two tables and no data rewrite, so
 * what needs proving is the shape: the indexes decision C-1/C-2 name exist, the
 * token is actually unique (the whole capability model rests on it), and a
 * comment cannot reference a publication that is not there.
 */
describe("migration 0004 — review links and media comments", () => {
  let dir: string;
  let db: Database.Database;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "waypoint-migrate-0004-"));
    db = new Database(path.join(dir, "waypoint.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(drizzle(db), { migrationsFolder });
    db.prepare(
      `INSERT INTO publications
         (id, title, sanitized_name, source_md, kind, content_type, search_text,
          r2_folder, public_base, origin, created_at, finalized_at)
       VALUES ('pub-1', 'Render', 'render', '', 'media', 'video/mp4', '',
               'smitty/shares/pub-1', 'dropzone.tylersavery.com', 'cli',
               '2026-09-15T00:00:00.000Z', '2026-09-15T00:01:00.000Z')`,
    ).run();
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the indexes the lookups depend on", () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    for (const index of [
      "review_links_token_idx",
      "review_links_publication_idx",
      "media_comments_publication_idx",
      "media_comments_unresolved_idx",
    ]) {
      expect(names).toContain(index);
    }
  });

  it("refuses two links with the same token", () => {
    const insert = db.prepare(
      `INSERT INTO review_links (id, publication_id, reviewer_name, token, created_at)
       VALUES (?, 'pub-1', ?, ?, '2026-09-15T00:00:00.000Z')`,
    );
    insert.run("link-1", "Jay", "deadbeef");
    expect(() => insert.run("link-2", "Aaron", "deadbeef")).toThrow(/UNIQUE/i);
  });

  it("holds a comment's anchor, region, and nullable link, and enforces its keys", () => {
    db.prepare(
      `INSERT INTO media_comments
         (id, publication_id, review_link_id, author_name, timecode_ms, region, body, created_at)
       VALUES ('c-1', 'pub-1', 'link-1', 'Jay', 12400, '{"x":0.1,"y":0.2,"w":0.3,"h":0.4}',
               'the wordmark lands too late here', '2026-09-15T00:02:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO media_comments (id, publication_id, author_name, body, created_at)
       VALUES ('c-2', 'pub-1', 'Tyler', 'author-side note', '2026-09-15T00:03:00.000Z')`,
    ).run();

    const rows = db
      .prepare("SELECT * FROM media_comments ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].timecode_ms).toBe(12400);
    expect(JSON.parse(String(rows[0].region))).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(rows[1].review_link_id).toBeNull();
    expect(rows[1].resolved_at).toBeNull();

    expect(() =>
      db
        .prepare(
          `INSERT INTO media_comments (id, publication_id, author_name, body, created_at)
           VALUES ('c-3', 'missing-publication', 'Jay', 'x', '2026-09-15T00:04:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
