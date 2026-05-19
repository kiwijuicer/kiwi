import path from "node:path";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/adapters": path.resolve(moduleDir, "../../packages/adapters/src/index.ts"),
      "@kiwi/contracts": path.resolve(moduleDir, "../../packages/contracts/src/index.ts"),
      "@kiwi/core": path.resolve(moduleDir, "../../packages/core/src/index.ts"),
      "@kiwi/ops": path.resolve(moduleDir, "../../packages/ops/src/index.ts"),
      "@kiwi/runtime": path.resolve(moduleDir, "../../packages/runtime/src/index.ts"),
      "@kiwi/sandbox": path.resolve(moduleDir, "../../packages/sandbox/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
