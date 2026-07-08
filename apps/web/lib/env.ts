import { existsSync } from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";

/**
 * Load the repo-root `.env` (§14, §16). The user drops a gitignored `.env`
 * holding `ANTHROPIC_API_KEY` at the repo root, but Next only auto-loads `.env`
 * from the app directory (`apps/web`), so it is pulled in here explicitly at
 * boot. Node-only; called from `instrumentation.ts`.
 *
 * The repo root is found by walking up from cwd toward a directory containing
 * `pnpm-workspace.yaml` — cwd alone is unreliable: the standalone server does
 * `process.chdir(.next/standalone/apps/web)`, which is neither the repo root
 * nor `apps/web` in the source tree.
 *
 * `override: false` means anything already in `process.env` (a real environment
 * variable, or Docker/compose env) always wins over the file — the file is a
 * dev convenience, never an override of production configuration. A missing file
 * is a no-op (this returns which paths, if any, were loaded).
 */
export function loadRepoEnv(): string[] {
  const candidates = new Set<string>([path.resolve(process.cwd(), ".env")]);

  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      candidates.add(path.join(dir, ".env"));
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const loaded: string[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    dotenvConfig({ path: file, override: false });
    loaded.push(file);
  }
  return loaded;
}
