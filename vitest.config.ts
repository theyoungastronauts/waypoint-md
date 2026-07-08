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
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
