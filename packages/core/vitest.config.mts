import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/contracts": path.resolve(moduleDir, "../../packages/contracts/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
