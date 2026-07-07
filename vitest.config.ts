import { defineConfig } from "vitest/config";

export default defineConfig({
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
