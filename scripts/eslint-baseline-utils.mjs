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
