import { writeFileSync } from "fs";
import { buildRunCompletionSummary } from "@kiwi/ops";
import { ensureRunLayout, inferAccessMode, readModelInvocations, resolveRunArtifactPath } from "@kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options.js";
import { printCostSummary } from "./run-summary.js";

interface CostOptions extends CliWorkspaceOptions {
  json?: boolean;
  csv?: boolean;
  now?: Date;
}

function csvField(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function writeCostCsv(params: { cwd: string; runId: string }): { ref: string; rows: number } {
  ensureRunLayout(params.runId, params.cwd);
  const invocations = readModelInvocations(params.cwd, params.runId);
  const header = [
    "phase",
    "stepId",
    "attemptId",
    "modelId",
    "providerName",
    "accessMode",
    "inputTokens",
    "outputTokens",
    "usagePrecision",
    "estimatedCostUsd",
  ];
  const rows = invocations.map((record) =>
    [
      record.phase,
      record.stepId ?? "",
      record.attemptId ?? "",
      record.modelId ?? "",
      record.providerName,
      record.accessMode ?? inferAccessMode(record) ?? "",
      record.usage.inputTokens,
      record.usage.outputTokens,
      record.usagePrecision,
      record.estimatedCostUsd ?? "",
    ]
      .map((value) => csvField(value))
      .join(","),
  );
  const ref = "final/final-cost-report.csv";
  writeFileSync(
    resolveRunArtifactPath(params.runId, ref, params.cwd),
    `${[header.join(","), ...rows].join("\n")}\n`,
    "utf-8",
  );

  return { ref, rows: invocations.length };
}

export async function runCost(runId: string, opts: CostOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const summary = buildRunCompletionSummary({
    cwd: workspace.workspacePath,
    runId,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const csv = opts.csv ? writeCostCsv({ cwd: workspace.workspacePath, runId }) : null;

  if (opts.json) {
    if (csv) {
      console.log(JSON.stringify({ ...summary, csvRef: csv.ref, csvRows: csv.rows }, null, 2));

      return;
    }
    console.log(JSON.stringify(summary, null, 2));

    return;
  }

  printCostSummary(summary);
  if (csv) {
    console.log(`csv: .kiwi/runs/${runId}/${csv.ref}`);
    console.log(`csv_rows: ${csv.rows}`);
  }
}
