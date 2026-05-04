import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  clean: true,
  sourcemap: true,
  noExternal: ["@ai-kiwi/core", "@ai-kiwi/contracts", "@ai-kiwi/adapters", "@ai-kiwi/sandbox"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
