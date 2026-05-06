import chalk from "chalk";
import { RunCompletionSummary } from "@kiwi/contracts";

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
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
}
