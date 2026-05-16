import { existsSync, readFileSync } from "node:fs";
import {
  eslintBaselinePath,
  eslintIssueKey,
  eslintReportPath,
  isHardEslintIssue,
  relativeReportPath,
  repoRootFromMeta,
} from "./eslint-baseline-utils.mjs";

const repoRoot = repoRootFromMeta(import.meta.url);
const reportPath = eslintReportPath(repoRoot);
const baselinePath = eslintBaselinePath(repoRoot);

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
const hardIssues = [];
const newIssues = [];

for (const file of report) {
  const filePath = relativeReportPath(repoRoot, file.filePath);
  const source = file.source ?? "";

  for (const message of file.messages) {
    if (isHardEslintIssue(message)) {
      hardIssues.push({ file: filePath, ...message, ruleId: message.ruleId ?? "unknown" });
      continue;
    }
    if (ignoredRuleIds.has(message.ruleId)) {
      continue;
    }

    const key = eslintIssueKey(filePath, message, source);

    if (!baselineSet.has(key)) {
      newIssues.push({
        file: filePath,
        severity: message.severity,
        ruleId: message.ruleId,
        line: message.line,
        column: message.column,
        message: message.message,
      });
    }
  }
}

if (hardIssues.length > 0) {
  console.error(`Found ${hardIssues.length} hard ESLint issue(s). Fix these instead of baselining them.`);
  for (const issue of hardIssues.slice(0, 40)) {
    console.error(
      `${issue.file}:${issue.line ?? "?"}:${issue.column ?? "?"} [${issue.severity}] ${issue.ruleId} ${issue.message}`,
    );
  }
  if (hardIssues.length > 40) {
    console.error(`... and ${hardIssues.length - 40} more`);
  }
  process.exit(1);
}

if (newIssues.length > 0) {
  console.error(`Found ${newIssues.length} new warning(s) not in baseline.`);
  for (const issue of newIssues.slice(0, 40)) {
    console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.severity}] ${issue.ruleId} ${issue.message}`);
  }
  if (newIssues.length > 40) {
    console.error(`... and ${newIssues.length - 40} more`);
  }
  process.exit(1);
}

console.log("ESLint baseline check passed.");
