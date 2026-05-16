import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/adapters": path.resolve(__dirname, "../adapters/src/index.ts"),
      "@kiwi/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
      "@kiwi/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@kiwi/runtime": path.resolve(__dirname, "../runtime/src/index.ts"),
      "@kiwi/sandbox": path.resolve(__dirname, "../sandbox/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
