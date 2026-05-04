import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-kiwi/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
      "@ai-kiwi/sandbox": path.resolve(__dirname, "../sandbox/src/index.ts"),
    },
  },
});
