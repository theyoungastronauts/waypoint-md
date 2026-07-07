/**
 * Test-only loader for the golden fixtures in `packages/spec/fixtures/` (§17.1).
 * Reads every `.md` file so invariant tests iterate over ALL fixtures — new
 * fixtures are covered automatically without touching the tests.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export interface Fixture {
  name: string;
  raw: string;
}

/** Every fixture, read as UTF-8 with CRLF and trailing bytes preserved. */
export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => ({ name: file, raw: readFileSync(join(FIXTURES_DIR, file), "utf8") }));
}
