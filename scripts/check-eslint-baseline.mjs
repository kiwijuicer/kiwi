import { existsSync, readFileSync } from "node:fs";
import {
  collectEslintReportIssues,
  eslintBaselinePath,
  eslintReportPath,
  printHardIssues,
  readEslintReport,
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

const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
const baselineSet = new Set(baseline.issueKeys ?? baseline.warningKeys ?? []);
const ignoredRuleIds = new Set(baseline.ignoredRuleIds ?? []);
const { hardIssues, newIssues } = collectEslintReportIssues(repoRoot, readEslintReport(repoRoot), {
  baselineSet,
  ignoredRuleIds,
});

if (hardIssues.length > 0) {
  printHardIssues(`Found ${hardIssues.length} hard ESLint issue(s). Fix these instead of baselining them.`, hardIssues);
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
