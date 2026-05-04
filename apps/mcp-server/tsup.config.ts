import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  clean: true,
  sourcemap: true,
  noExternal: ["@kiwi/core", "@kiwi/contracts", "@kiwi/adapters", "@kiwi/sandbox"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
