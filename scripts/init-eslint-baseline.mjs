import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  console.error(`Missing ESLint report at ${reportPath}. Run: pnpm lint:eslint`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf-8"));
const issueKeys = [];
const hardIssues = [];

for (const file of report) {
  const filePath = relativeReportPath(repoRoot, file.filePath);
  const source = file.source ?? "";

  for (const message of file.messages) {
    if (isHardEslintIssue(message)) {
      hardIssues.push({ file: filePath, ...message, ruleId: message.ruleId ?? "unknown" });
      continue;
    }
    issueKeys.push(eslintIssueKey(filePath, message, source));
  }
}

if (hardIssues.length > 0) {
  console.error(`Found ${hardIssues.length} hard ESLint issue(s). Fix these before writing a warning baseline.`);
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

issueKeys.sort();
mkdirSync(new URL("../config", import.meta.url), { recursive: true });
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

console.log(`Wrote baseline with ${issueKeys.length} warning key(s) to ${baselinePath}`);
