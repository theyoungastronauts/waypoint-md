import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the apps/web `@/*` path alias so route-handler tests can import it.
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
    },
  },
  // Use React's automatic JSX runtime so component tests don't need `import React`
  // (matches how Next transforms the app's .tsx files).
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    include: [
      "packages/*/src/**/*.{test,spec}.ts",
      "apps/web/**/*.{test,spec}.{ts,tsx}",
    ],
    // `apps/web/e2e/**` holds Playwright specs (`pnpm test:e2e`), which drive a
    // real browser and must never run under vitest — keep the standing gate fast.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/e2e/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
