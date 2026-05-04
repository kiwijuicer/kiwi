import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));
const tsFiles = ["**/*.{ts,tsx,mts,cts}"];

const CANONICAL_LITERAL_VALUES = [
  "planner",
  "researcher",
  "executor",
  "reviewer",
  "security",
  "rules",
  "cheap",
  "mid",
  "strong",
  "frontier",
  "typecheck",
  "lint",
  "tests",
  "pass",
  "fail",
  "blocked",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "needs_changes",
  "pass_with_comments",
  "reject",
  "bitbucket-cloud",
  "github",
  "local",
];

const CANONICAL_LITERAL_RULES = CANONICAL_LITERAL_VALUES.map((value) => ({
  selector: `Literal[value='${value}']`,
  message:
    `Avoid canonical domain string '${value}' outside contracts/constants. ` +
    "Use exported constants/unions from @kiwi/contracts.",
}));

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.kiwi/**",
      "**/coverage/**",
      "**/.tmp/**",
      ".tmp/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: tsFiles,
    languageOptions: {
      ...(config.languageOptions ?? {}),
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        projectService: true,
        tsconfigRootDir,
      },
    },
  })),
  {
    files: tsFiles,
    plugins: {
      sonarjs,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-definitions": ["warn", "interface"],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }],
      "sonarjs/cognitive-complexity": ["warn", 20],
      "sonarjs/no-duplicated-branches": "warn",
      "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],
      "no-restricted-syntax": ["warn", ...CANONICAL_LITERAL_RULES],
    },
  },
  {
    files: ["packages/contracts/src/schemas.ts"],
    rules: {
      "max-lines": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "sonarjs/no-duplicate-string": "off",
      "no-restricted-syntax": "off",
    },
  },
];
