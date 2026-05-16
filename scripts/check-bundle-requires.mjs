import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("usage: node scripts/check-bundle-requires.mjs <dist-file>...");
  process.exit(1);
}

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function isAllowedRequire(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return true;
  }
  const normalized = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;

  return (
    builtins.has(specifier) || builtinModules.some((name) => normalized === name || normalized.startsWith(`${name}/`))
  );
}

const failures = [];
const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

for (const file of files) {
  const source = readFileSync(file, "utf-8");

  for (const match of source.matchAll(requirePattern)) {
    const specifier = match[1];

    if (!isAllowedRequire(specifier)) {
      failures.push(`${file}: external require("${specifier}")`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
