import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "repomix-output.xml"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.{js,mjs,ts,tsx}"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
