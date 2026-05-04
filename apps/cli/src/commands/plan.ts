import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import {
  NotInitializedError,
  buildDeterministicTaskGraph,
  createInitiativeFromInput,
  generateRunId,
  isInitialized,
  loadPolicy,
  loadRegistry,
  savePlannedRun,
} from "@ai-kiwi/core";

export interface PlanOptions {
  dryRun?: boolean;
  riskProfile?: "local" | "dev" | "staging" | "production";
  budgetProfile?: "tiny" | "small" | "normal" | "large" | "critical";
  now?: Date;
  runId?: string;
  runIdSuffix?: string;
  initiativeIdSuffix?: string;
  planIdSuffix?: string;
}

function looksLikeTicketPath(ticketArg: string): boolean {
  return (
    path.isAbsolute(ticketArg) ||
    ticketArg.startsWith(".") ||
    ticketArg.includes("/") ||
    /\.(md|markdown|txt)$/i.test(ticketArg)
  );
}

function resolveTicketInput(
  ticketArg: string,
  cwd: string,
): { rawInput: string; source: "file" | "cli" } {
  const ticketPath = path.isAbsolute(ticketArg) ? ticketArg : path.join(cwd, ticketArg);
  if (existsSync(ticketPath)) {
    return {
      rawInput: readFileSync(ticketPath, "utf-8"),
      source: "file",
    };
  }

  if (looksLikeTicketPath(ticketArg)) {
    throw new Error(`Ticket file not found: ${ticketPath}`);
  }

  return {
    rawInput: ticketArg,
    source: "cli",
  };
}

export async function runPlan(
  ticketArg: string,
  opts: PlanOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  if (!isInitialized(cwd)) {
    throw new NotInitializedError(cwd);
  }

  const policy = loadPolicy(path.join(cwd, "kiwi-policy.yaml"));
  loadRegistry(path.join(cwd, "model-registry.yaml"));

  const { rawInput, source } = resolveTicketInput(ticketArg, cwd);
  const now = opts.now ?? new Date();
  const runIdOptions = opts.runIdSuffix ? { suffix: opts.runIdSuffix } : {};
  const runId = opts.runId ?? generateRunId(now, runIdOptions);
  const initiativeParams = opts.initiativeIdSuffix
    ? {
        rawInput,
        repoPath: cwd,
        source,
        riskProfile: opts.riskProfile ?? "dev",
        budgetProfile: opts.budgetProfile ?? "normal",
        now,
        idSuffix: opts.initiativeIdSuffix,
      }
    : {
        rawInput,
        repoPath: cwd,
        source,
        riskProfile: opts.riskProfile ?? "dev",
        budgetProfile: opts.budgetProfile ?? "normal",
        now,
      };
  const initiative = createInitiativeFromInput(initiativeParams);
  const taskGraph = buildDeterministicTaskGraph({
    runId,
    initiative,
    policy,
    now,
    ...(opts.planIdSuffix ? { planIdSuffix: opts.planIdSuffix } : {}),
  });

  if (opts.dryRun) {
    console.log(JSON.stringify({ runId, initiative, taskGraph }, null, 2));
    return;
  }

  savePlannedRun({
    runId,
    initiative,
    taskGraph,
    cwd,
    now,
  });

  console.log(chalk.green("✓") + " Run planned");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`steps: ${taskGraph.steps.length}`));
  console.log(chalk.dim(`saved: .kiwi/runs/${runId}/`));
}
