import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(".tmp", { recursive: true });

const result = spawnSync(
  "eslint",
  ["apps", "packages", "scripts", "--ext", ".ts,.tsx,.js,.mjs,.cjs", "-f", "json", "-o", ".tmp/eslint-report.json"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
