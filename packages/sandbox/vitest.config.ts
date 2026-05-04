import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-kiwi/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
