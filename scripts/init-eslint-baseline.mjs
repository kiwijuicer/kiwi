import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repoRoot, ".tmp", "eslint-report.json");
const baselinePath = path.join(repoRoot, "config", "eslint-baseline.json");

if (!existsSync(reportPath)) {
  console.error(`Missing ESLint report at ${reportPath}. Run: pnpm lint:eslint`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));
const issueKeys = [];

for (const file of report) {
  const filePath = path.relative(repoRoot, file.filePath).replace(/\\/g, "/");
  for (const message of file.messages) {
    if (typeof message.ruleId !== "string" || message.ruleId.length === 0) continue;
    const ruleId = message.ruleId ?? "unknown";
    issueKeys.push(`${filePath}|${ruleId}|${message.line}|${message.column}|${message.severity}`);
  }
}

issueKeys.sort();
mkdirSync(path.dirname(baselinePath), { recursive: true });
writeFileSync(
  baselinePath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      issueKeys,
      ignoredRuleIds: [],
    },
    null,
    2,
  ) + "\n",
);

console.log(`Wrote baseline with ${issueKeys.length} issue key(s) to ${baselinePath}`);
