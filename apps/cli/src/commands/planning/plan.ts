import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import { AccessModes, ContractValues, type BudgetProfile, type RiskProfile } from "@kiwi/contracts";
import {
  buildRunCostForecast,
  generateRunId,
  NotInitializedError,
  isInitialized,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  planRun,
} from "@kiwi/core";
import { resolvePlannerProvider } from "@kiwi/runtime";
import {
  CliProgressStatuses,
  type CliProgressStatus,
  TicketInputSources,
  type TicketInputSource,
} from "../../config/constants";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options";

interface PlanOptions extends CliWorkspaceOptions {
  dryRun?: boolean;
  riskProfile?: RiskProfile;
  budgetProfile?: BudgetProfile;
  now?: Date;
  runId?: string;
  runIdSuffix?: string;
  initiativeIdSuffix?: string;
  planIdSuffix?: string;
  allowStub?: boolean;
  env?: Record<string, string | undefined>;
  progress?: PlanProgressOptions;
}

interface PlanProgressOptions {
  enabled?: boolean;
  write?: (line: string) => void;
  nowMs?: () => number;
}

type ProgressValue = string | number | boolean | null | undefined;
type PlanProgressStatus = CliProgressStatus | typeof ContractValues.Completed | typeof ContractValues.Failed;

interface PlanProgressReporter {
  line(line: string): void;
  phase(phase: string, status: PlanProgressStatus, fields?: Record<string, ProgressValue>): void;
  startHeartbeat(): void;
  stopHeartbeat(): void;
}

function formatProgressValue(value: Exclude<ProgressValue, undefined>): string {
  const raw = String(value);

  return /^[A-Za-z0-9._:/@-]+$/.test(raw) ? raw : JSON.stringify(raw);
}

function formatProgressLine(
  phase: string,
  status: PlanProgressStatus,
  fields: Record<string, ProgressValue> = {},
): string {
  const entries: string[] = [];

  for (const [key, value] of Object.entries({ phase, status, ...fields }) as Array<[string, ProgressValue]>) {
    if (value === undefined) {
      continue;
    }
    entries.push(`${key}=${formatProgressValue(value)}`);
  }

  return entries.join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function createPlanProgressReporter(opts: {
  dryRun?: boolean | undefined;
  progress?: PlanProgressOptions | undefined;
}): PlanProgressReporter {
  const enabled = !opts.dryRun && (opts.progress?.enabled ?? process.stderr.isTTY);
  const write = opts.progress?.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const nowMs = opts.progress?.nowMs ?? (() => Date.now());
  let startedAt = 0;
  let timer: NodeJS.Timeout | null = null;

  return {
    line(line: string): void {
      if (!enabled) {
        return;
      }
      write(line);
    },
    phase(phase: string, status: PlanProgressStatus, fields?: Record<string, ProgressValue>): void {
      if (!enabled) {
        return;
      }
      write(formatProgressLine(phase, status, fields));
    },
    startHeartbeat(): void {
      if (!enabled || timer) {
        return;
      }
      startedAt = nowMs();
      timer = setInterval(() => {
        const elapsedSeconds = Math.max(0, Math.floor((nowMs() - startedAt) / 1000));
        write(`still planning... ${elapsedSeconds}s elapsed`);
      }, 30_000);
    },
    stopHeartbeat(): void {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },
  };
}

function looksLikeTicketPath(ticketArg: string): boolean {
  return (
    path.isAbsolute(ticketArg) ||
    ticketArg.startsWith(".") ||
    ticketArg.includes("/") ||
    /\.(md|markdown|txt)$/i.test(ticketArg)
  );
}

function resolveTicketInput(ticketArg: string, cwd: string): { rawInput: string; source: TicketInputSource } {
  const ticketPath = path.isAbsolute(ticketArg) ? ticketArg : path.join(cwd, ticketArg);

  if (existsSync(ticketPath)) {
    return {
      rawInput: readFileSync(ticketPath, "utf-8"),
      source: TicketInputSources.File,
    };
  }

  if (looksLikeTicketPath(ticketArg)) {
    throw new Error(`Ticket file not found: ${ticketPath}`);
  }

  return {
    rawInput: ticketArg,
    source: TicketInputSources.Cli,
  };
}

export async function runPlan(ticketArg: string, opts: PlanOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const progress = createPlanProgressReporter({ dryRun: opts.dryRun, progress: opts.progress });
  progress.line("Planning run...");
  const workspace = resolveCliWorkspace(opts, cwd, true);
  const workspacePath = workspace.workspacePath;
  const repo = workspace.repo!;
  progress.line(chalk.dim(`workspace: ${workspacePath}`));
  progress.line(chalk.dim(`repo: ${repo.id} (${repo.path})`));

  if (!isInitialized(workspacePath)) {
    throw new NotInitializedError(workspacePath);
  }

  const policy = loadEffectivePolicy(workspacePath, opts.env ? { env: opts.env } : {});
  const registry = loadEffectiveRegistry(workspacePath, opts.env ? { env: opts.env } : {});

  const { rawInput, source } = resolveTicketInput(ticketArg, cwd);
  const now = opts.now ?? new Date();
  const resolution = resolvePlannerProvider({
    registryModels: registry.models,
    now: () => now,
    preferenceByRole: policy.routing.providerPreference,
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.planIdSuffix ? { planIdSuffix: opts.planIdSuffix } : {}),
    ...(opts.allowStub ? { allowStub: opts.allowStub } : {}),
  });
  const plannerModel = resolution.model;
  const provider = resolution.provider;
  const runId = opts.runId ?? generateRunId(now, opts.runIdSuffix ? { suffix: opts.runIdSuffix } : {});
  progress.line(
    plannerModel.accessMode === AccessModes.Stub
      ? chalk.yellow(`planner: ${plannerModel.id} (${provider.name})`)
      : chalk.dim(`planner: ${plannerModel.id} (${provider.name})`),
  );
  progress.line(chalk.dim(`runId: ${runId}`));
  progress.line("generating TaskGraph, this can take a few minutes...");
  progress.phase(ContractValues.Planner, CliProgressStatuses.Started, {
    runId,
    model: plannerModel.id,
    provider: provider.name,
  });

  let planned: Awaited<ReturnType<typeof planRun>>;
  progress.startHeartbeat();
  try {
    planned = await planRun({
      workspacePath,
      repoId: repo.id,
      repoPath: repo.path,
      rawInput,
      source,
      policy,
      plannerModel,
      executePlanner: (plannerInput, options) => runPlannerProviderWithRetries(provider, plannerInput, options),
      riskProfile: opts.riskProfile ?? "dev",
      budgetProfile: opts.budgetProfile ?? "normal",
      now,
      runId,
      ...(opts.initiativeIdSuffix ? { initiativeIdSuffix: opts.initiativeIdSuffix } : {}),
      ...(opts.planIdSuffix ? { planIdSuffix: opts.planIdSuffix } : {}),
      persistRunArtifacts: !opts.dryRun,
    });
    progress.phase(ContractValues.Planner, ContractValues.Completed, {
      runId: planned.runId,
      steps: planned.taskGraph.steps.length,
    });
  } catch (error) {
    progress.phase(ContractValues.Planner, ContractValues.Failed, {
      runId,
      error: errorMessage(error),
    });
    throw error;
  } finally {
    progress.stopHeartbeat();
  }
  progress.line("valid TaskGraph received; artifacts written.");

  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          runId: planned.runId,
          initiative: planned.initiative,
          plannerModelId: planned.plannerModelId,
          taskGraph: planned.taskGraph,
          plannerInput: planned.plannerInput,
          plannerOutput: planned.plannerOutput,
        },
        null,
        2,
      ),
    );

    return;
  }

  console.log(chalk.green("✓") + " Run planned");
  console.log(chalk.dim(`runId: ${planned.runId}`));
  console.log(chalk.dim(`workspace: ${workspacePath}`));
  console.log(chalk.dim(`repo: ${repo.id} (${repo.path})`));
  const plannerLine = `planner: ${planned.plannerModelId} (${planned.providerName})`;
  console.log(plannerModel.accessMode === AccessModes.Stub ? chalk.yellow(plannerLine) : chalk.dim(plannerLine));
  console.log(chalk.dim(`steps: ${planned.taskGraph.steps.length}`));
  const forecast = buildRunCostForecast({
    taskGraph: planned.taskGraph,
    plannerCostUsd: planned.plannerOutput.cost.estimatedUsd,
  });
  console.log(
    chalk.dim(
      `estimated cost: ${formatUsd(forecast.estimatedCostUsd)} (planner ${formatUsd(
        forecast.phaseCostsUsd.planner,
      )} + execution ${formatUsd(forecast.phaseCostsUsd.execution)} + review ${formatUsd(
        forecast.phaseCostsUsd.review,
      )})`,
    ),
  );
  console.log(chalk.dim(`saved: .kiwi/runs/${planned.runId}/`));
}
