import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import { AccessModes } from "@kiwi/contracts";
import {
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  generateRunId,
  NotInitializedError,
  isInitialized,
  loadPolicy,
  loadRegistry,
  planRun,
} from "@kiwi/core";
import { resolvePlannerProvider } from "@kiwi/runtime";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

interface PlanOptions extends CliWorkspaceOptions {
  dryRun?: boolean;
  riskProfile?: "local" | "dev" | "staging" | "production";
  budgetProfile?: "tiny" | "small" | "normal" | "large" | "critical";
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

interface PlanProgressReporter {
  line(line: string): void;
  startHeartbeat(): void;
  stopHeartbeat(): void;
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
      if (!enabled) return;
      write(line);
    },
    startHeartbeat(): void {
      if (!enabled || timer) return;
      startedAt = nowMs();
      timer = setInterval(() => {
        const elapsedSeconds = Math.max(0, Math.floor((nowMs() - startedAt) / 1000));
        write(`still planning... ${elapsedSeconds}s elapsed`);
      }, 30_000);
    },
    stopHeartbeat(): void {
      if (!timer) return;
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

function resolveTicketInput(ticketArg: string, cwd: string): { rawInput: string; source: "file" | "cli" } {
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

  const policy = loadPolicy(kiwiPolicyPath(workspacePath));
  const registry = loadRegistry(kiwiModelRegistryPath(workspacePath));

  const { rawInput, source } = resolveTicketInput(ticketArg, cwd);
  const now = opts.now ?? new Date();
  const resolution = resolvePlannerProvider({
    registryModels: registry.models,
    now: () => now,
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
  console.log(chalk.dim(`saved: .kiwi/runs/${planned.runId}/`));
}
