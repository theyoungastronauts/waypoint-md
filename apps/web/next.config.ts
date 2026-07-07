import path from "node:path";
import type { NextConfig } from "next";

// `next build` runs with cwd = apps/web (invoked via the workspace script),
// so the monorepo root is two levels up. Setting this explicitly keeps the
// standalone dependency trace correct and silences Next's root-inference warning.
const monorepoRoot = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  // Docker image runs `node server.js` from the standalone output (§16).
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // @waypoint/spec is consumed straight from its TypeScript source.
  transpilePackages: ["@waypoint/spec"],
  // better-sqlite3 is a native module — keep it out of the bundle.
  serverExternalPackages: ["better-sqlite3"],
  // Lint is a separate standing gate (`pnpm lint`); don't re-run it during build.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
