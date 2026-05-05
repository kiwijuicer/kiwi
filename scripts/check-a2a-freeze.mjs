import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const STATUS_PATH = "docs/plans/step-22-end-to-end-real-run-demo.md";
const ALLOWLIST_PATH = "config/a2a-freeze-allowlist.json";
const SENSITIVE_PREFIXES = [
  "packages/core/src/a2a/",
  "packages/core/src/a2a-runtime.ts",
  "apps/cli/src/commands/a2a.ts",
  "apps/cli/src/commands/register-a2a.ts",
  "packages/contracts/src/a2a.ts",
  "packages/contracts/src/__fixtures__/a2a-envelope.json",
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function step22Done() {
  if (!existsSync(STATUS_PATH)) return false;
  return /^Status:\s*DONE\s*$/m.test(readFileSync(STATUS_PATH, "utf-8"));
}

function changedFiles() {
  const output = git(["diff", "--name-only", "HEAD", "--", ...SENSITIVE_PREFIXES]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function allowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return { allowedMechanicalPaths: [] };
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf-8"));
}

if (!step22Done()) {
  const changed = changedFiles();
  const allowed = new Set(allowlist().allowedMechanicalPaths ?? []);
  const forbidden = changed.filter((file) => !allowed.has(file));

  if (forbidden.length > 0) {
    console.error("A2A freeze violation while Step 22 is not DONE.");
    console.error("Forbidden changes:");
    for (const file of forbidden) console.error(`- ${file}`);
    console.error("Only documented mechanical move/import updates are allowed before Step 22 is complete.");
    process.exit(1);
  }
}

console.log("A2A freeze check passed.");
