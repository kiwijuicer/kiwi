import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  console.error(`Missing ESLint report at ${reportPath}. Run: pnpm lint:eslint`);
  process.exit(1);
}

const { hardIssues, issueKeys } = collectEslintReportIssues(repoRoot, readEslintReport(repoRoot));

if (hardIssues.length > 0) {
  printHardIssues(
    `Found ${hardIssues.length} hard ESLint issue(s). Fix these before writing a warning baseline.`,
    hardIssues,
  );
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
