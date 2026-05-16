import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "config", "file-size-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
const allowOver1000 = new Set(baseline.allowOver1000Lines ?? []);
const sourceRoots = ["apps", "packages"];
const offenders = [];

function walk(dirPath) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".kiwi") {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    if (fullPath.includes(`${path.sep}__tests__${path.sep}`)) {
      continue;
    }
    const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, "/");
    const lines = readFileSync(fullPath, "utf-8").split(/\r?\n/).length;

    if (lines > 1000 && !allowOver1000.has(relativePath)) {
      offenders.push({ file: relativePath, lines });
    }
  }
}

for (const root of sourceRoots) {
  walk(path.join(repoRoot, root));
}

if (offenders.length > 0) {
  console.error("Source files over 1000 lines not in baseline:");
  for (const offender of offenders) {
    console.error(`${offender.file}: ${offender.lines}`);
  }
  process.exit(1);
}

console.log("File-size gate passed.");
