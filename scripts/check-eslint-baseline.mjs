import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repoRoot, ".tmp", "eslint-report.json");
const baselinePath = path.join(repoRoot, "config", "eslint-baseline.json");

if (!existsSync(reportPath)) {
  console.error(`Missing ESLint report at ${reportPath}. Run lint:eslint first.`);
  process.exit(1);
}

if (!existsSync(baselinePath)) {
  console.error(`Missing baseline at ${baselinePath}.`);
  console.error("Generate baseline once: pnpm lint:baseline:init");
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));
const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
const baselineSet = new Set(baseline.issueKeys ?? baseline.warningKeys ?? []);
const ignoredRuleIds = new Set(baseline.ignoredRuleIds ?? []);

const newIssues = [];

for (const file of report) {
  const filePath = path.relative(repoRoot, file.filePath).replace(/\\/g, "/");
  for (const message of file.messages) {
    const ruleId = message.ruleId ?? "unknown";
    if (typeof message.ruleId !== "string" || message.ruleId.length === 0) continue;
    if (ignoredRuleIds.has(ruleId)) continue;
    const key = `${filePath}|${ruleId}|${message.line}|${message.column}|${message.severity}`;
    if (!baselineSet.has(key)) {
      newIssues.push({
        file: filePath,
        severity: message.severity,
        ruleId,
        line: message.line,
        column: message.column,
        message: message.message,
      });
    }
  }
}

if (newIssues.length > 0) {
  console.error(`Found ${newIssues.length} new issue(s) not in baseline.`);
  for (const issue of newIssues.slice(0, 40)) {
    console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.severity}] ${issue.ruleId} ${issue.message}`);
  }
  if (newIssues.length > 40) {
    console.error(`... and ${newIssues.length - 40} more`);
  }
  process.exit(1);
}

console.log("ESLint baseline check passed.");
