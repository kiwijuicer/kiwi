import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
      "@kiwi/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
