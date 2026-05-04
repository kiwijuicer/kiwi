import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
