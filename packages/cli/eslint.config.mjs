import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `skills/**` is a build artifact copied from the repo root; `scripts/**` is
  // Node build tooling, not linted app source.
  { ignores: ["dist/**", "node_modules/**", "skills/**", "scripts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
