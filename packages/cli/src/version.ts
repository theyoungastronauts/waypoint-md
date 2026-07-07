import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read the CLI version from package.json at runtime. Resolved relative to the
 * compiled file (dist/version.js -> ../package.json), which is shipped in the
 * published tarball (`files: ["dist"]` + package.json at the root).
 */
export function getVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
