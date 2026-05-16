import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/adapters": path.resolve(__dirname, "../../packages/adapters/src/index.ts"),
      "@kiwi/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@kiwi/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@kiwi/ops": path.resolve(__dirname, "../../packages/ops/src/index.ts"),
      "@kiwi/runtime": path.resolve(__dirname, "../../packages/runtime/src/index.ts"),
      "@kiwi/sandbox": path.resolve(__dirname, "../../packages/sandbox/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
