import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: ["@kiwi/core", "@kiwi/contracts", "@kiwi/adapters", "@kiwi/sandbox", "@kiwi/runtime", "js-yaml", "zod"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
