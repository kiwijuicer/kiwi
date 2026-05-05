import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));
const sourceTsFiles = ["apps/*/src/**/*.{ts,tsx,mts,cts}", "packages/*/src/**/*.{ts,tsx,mts,cts}"];
const configTsFiles = ["apps/*/*.config.ts", "packages/*/*.config.ts", "*.config.ts"];
const jsFiles = ["**/*.{js,mjs,cjs}"];

const nodeGlobals = {
  AbortController: "readonly",
  AbortSignal: "readonly",
  Buffer: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  URL: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

const commonJsGlobals = {
  ...nodeGlobals,
  __dirname: "readonly",
  __filename: "readonly",
  exports: "readonly",
  module: "readonly",
  require: "readonly",
};

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
  selector: `Literal[value='${value}']:not(TSLiteralType > Literal)`,
  message:
    `Avoid canonical domain string '${value}' outside contracts/constants. ` +
    "Use exported constants/unions from @kiwi/contracts.",
}));

const withFiles = (config, files, extraLanguageOptions = {}) => ({
  ...config,
  files,
  languageOptions: {
    ...(config.languageOptions ?? {}),
    ...extraLanguageOptions,
    parserOptions: {
      ...(config.languageOptions?.parserOptions ?? {}),
      ...(extraLanguageOptions.parserOptions ?? {}),
    },
  },
});

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
  {
    ...js.configs.recommended,
    files: [...sourceTsFiles, ...configTsFiles, ...jsFiles],
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: commonJsGlobals,
      sourceType: "commonjs",
    },
  },
  {
    files: ["**/*.{js,mjs}", ...configTsFiles, "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: nodeGlobals,
      sourceType: "module",
    },
  },
  ...tseslint.configs.recommended.map((config) =>
    withFiles(config, sourceTsFiles, {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    }),
  ),
  ...tseslint.configs.recommended.map((config) =>
    withFiles(config, configTsFiles, {
      parserOptions: {
        tsconfigRootDir,
      },
    }),
  ),
  {
    files: sourceTsFiles,
    plugins: {
      sonarjs,
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["warn", "interface"],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }],
      "no-restricted-syntax": ["warn", ...CANONICAL_LITERAL_RULES],
      "sonarjs/cognitive-complexity": ["warn", 20],
      "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],
      "sonarjs/no-duplicated-branches": "warn",
    },
  },
  {
    files: [
      "packages/contracts/src/schemas.ts",
      "packages/contracts/src/common.ts",
      "packages/contracts/src/domain.ts",
      "packages/contracts/src/execution.ts",
      "packages/contracts/src/policy.ts",
      "packages/contracts/src/scm.ts",
      "packages/contracts/src/a2a.ts",
      "packages/contracts/src/evidence.ts",
    ],
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
      "no-restricted-syntax": "off",
      "sonarjs/no-duplicate-string": "off",
    },
  },
];
