import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/adapters": path.resolve(moduleDir, "../adapters/src/index.ts"),
      "@kiwi/contracts": path.resolve(moduleDir, "../contracts/src/index.ts"),
      "@kiwi/core": path.resolve(moduleDir, "../core/src/index.ts"),
      "@kiwi/runtime": path.resolve(moduleDir, "../runtime/src/index.ts"),
      "@kiwi/sandbox": path.resolve(moduleDir, "../sandbox/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
