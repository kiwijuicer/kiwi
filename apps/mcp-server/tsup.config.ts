import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: [
    "@kiwi/core",
    "@kiwi/ops",
    "@kiwi/contracts",
    "@kiwi/adapters",
    "@kiwi/sandbox",
    "@kiwi/runtime",
    "js-yaml",
    "zod",
  ],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
