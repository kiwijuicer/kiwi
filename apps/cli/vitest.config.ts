import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-kiwi/adapters": path.resolve(__dirname, "../../packages/adapters/src/index.ts"),
      "@ai-kiwi/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@ai-kiwi/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@ai-kiwi/sandbox": path.resolve(__dirname, "../../packages/sandbox/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
