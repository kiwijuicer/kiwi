import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
