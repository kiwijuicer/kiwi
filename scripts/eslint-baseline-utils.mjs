import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRootFromMeta(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

export function eslintReportPath(repoRoot) {
  return path.join(repoRoot, ".tmp", "eslint-report.json");
}

export function eslintBaselinePath(repoRoot) {
  return path.join(repoRoot, "config", "eslint-baseline.json");
}

export function relativeReportPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

export function isHardEslintIssue(message) {
  return (
    message.fatal === true ||
    message.severity === 2 ||
    typeof message.ruleId !== "string" ||
    message.ruleId.length === 0
  );
}

export function eslintIssueKey(filePath, message, source) {
  const ruleId = message.ruleId ?? "unknown";
  const lineText = typeof message.line === "number" ? (source.split(/\r?\n/)[message.line - 1]?.trim() ?? "") : "";

  return [filePath, ruleId, message.severity, message.message, lineText].join("|");
}

export function readEslintReport(repoRoot) {
  return JSON.parse(readFileSync(eslintReportPath(repoRoot), "utf-8"));
}

export function collectEslintReportIssues(repoRoot, report, options = {}) {
  const baselineSet = options.baselineSet ?? null;
  const ignoredRuleIds = options.ignoredRuleIds ?? new Set();
  const hardIssues = [];
  const issueKeys = [];
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
      issueKeys.push(key);

      if (baselineSet && !baselineSet.has(key)) {
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

  return { hardIssues, issueKeys, newIssues };
}

export function printHardIssues(heading, issues) {
  console.error(heading);
  for (const issue of issues.slice(0, 40)) {
    console.error(
      `${issue.file}:${issue.line ?? "?"}:${issue.column ?? "?"} [${issue.severity}] ${issue.ruleId} ${issue.message}`,
    );
  }
  if (issues.length > 40) {
    console.error(`... and ${issues.length - 40} more`);
  }
}
