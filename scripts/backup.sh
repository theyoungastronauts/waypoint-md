#!/usr/bin/env bash
#
# Waypoint backup (§16). Produces a consistent snapshot of the SQLite database
# using the sqlite3 online-backup API, which is safe to run against a live
# server in WAL mode (a plain `cp` of the .db file can miss un-checkpointed WAL
# pages). Uploaded documents are stored *inside* the database (the `raw_md`
# column), so the single .db file is the entire dataset — there is nothing else
# to copy.
#
# Usage:
#   scripts/backup.sh [DATA_DIR] [OUT_DIR]
#
#   DATA_DIR  directory holding waypoint.db   (default: $WAYPOINT_DATA_DIR, else ~/.waypoint/data)
#   OUT_DIR   directory to write the snapshot (default: ./backups)
#
# Restore: stop the server, then copy the snapshot back to
#   $WAYPOINT_DATA_DIR/waypoint.db
# (remove any stale waypoint.db-wal / waypoint.db-shm beside it first).

set -euo pipefail

DATA_DIR="${1:-${WAYPOINT_DATA_DIR:-$HOME/.waypoint/data}}"
OUT_DIR="${2:-./backups}"

DB="$DATA_DIR/waypoint.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: sqlite3 is not installed or not on PATH." >&2
  exit 1
fi

if [ ! -f "$DB" ]; then
  echo "error: no database at $DB" >&2
  echo "       pass the data dir as the first argument, or set WAYPOINT_DATA_DIR." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/waypoint-$STAMP.db"

# .backup runs the online-backup API: a transactionally consistent copy, safe
# while the server is running.
sqlite3 "$DB" ".backup '$OUT'"

# Verify the snapshot opens and passes an integrity check before claiming success.
if [ "$(sqlite3 "$OUT" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "error: integrity check failed on $OUT" >&2
  exit 1
fi

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1)), integrity check ok."
