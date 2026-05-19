import path from "node:path";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@kiwi/contracts": path.resolve(moduleDir, "../contracts/src/index.ts"),
      "@kiwi/sandbox": path.resolve(moduleDir, "../sandbox/src/index.ts"),
    },
  },
});
