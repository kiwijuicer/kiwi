import chalk from "chalk";
import { RunCompletionSummary } from "@kiwi/contracts";

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function printWarnings(summary: RunCompletionSummary): void {
  if (summary.warnings.length === 0) return;
  for (const warning of summary.warnings) {
    console.log(chalk.yellow(`warning: ${warning}`));
  }
}

function printByStepCosts(summary: RunCompletionSummary): void {
  const stepIds = Object.keys(summary.byStepCostsUsd).sort();
  if (stepIds.length === 0) return;
  console.log("cost_by_step:");
  for (const stepId of stepIds) {
    const cost = summary.byStepCostsUsd[stepId];
    if (!cost) continue;
    console.log(
      `  ${stepId}: planner ${formatUsd(cost.planner)} · executor ${formatUsd(cost.executor)} · reviewer ${formatUsd(cost.reviewer)}`,
    );
  }
}

function printByModelCosts(summary: RunCompletionSummary): void {
  const rows = Object.entries(summary.byModelCostsUsd).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return;
  console.log("cost_by_model:");
  for (const [modelLabel, cost] of rows) {
    console.log(`  ${modelLabel}: ${formatUsd(cost)}`);
  }
}

export function printRunCompletionSummary(summary: RunCompletionSummary): void {
  console.log(chalk.dim(summary.compact));
  console.log(
    chalk.dim(
      `cost_by_phase: planner ${formatUsd(summary.phaseCostsUsd.planner)} · executor ${formatUsd(summary.phaseCostsUsd.executor)} · reviewer ${formatUsd(summary.phaseCostsUsd.reviewer)}`,
    ),
  );
  console.log(
    chalk.dim(
      `attempts: ${summary.attempts.total} total, ${summary.attempts.failed} failed, ${summary.attempts.blocked} blocked`,
    ),
  );
  printWarnings(summary);
  printByStepCosts(summary);
  printByModelCosts(summary);
  console.log(chalk.dim(`next: ${summary.nextAction}`));
}

export function printCostSummary(summary: RunCompletionSummary): void {
  console.log(summary.compact);
  console.log(`planner: ${formatUsd(summary.phaseCostsUsd.planner)}`);
  console.log(`executor: ${formatUsd(summary.phaseCostsUsd.executor)}`);
  console.log(`reviewer: ${formatUsd(summary.phaseCostsUsd.reviewer)}`);
  console.log(
    `usage_precision: exact=${summary.usagePrecision.exact} estimated=${summary.usagePrecision.estimated} unknown=${summary.usagePrecision.unknown}`,
  );
  printWarnings(summary);
  printByStepCosts(summary);
  printByModelCosts(summary);
}
