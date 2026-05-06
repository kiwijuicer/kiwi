import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { runPlannerProviderWithRetries } from "@kiwi/adapters";
import {
  kiwiModelRegistryPath,
  kiwiPolicyPath,
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
  const workspace = resolveCliWorkspace(opts, cwd, true);
  const workspacePath = workspace.workspacePath;
  const repo = workspace.repo!;

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
    ...(opts.planIdSuffix ? { planIdSuffix: opts.planIdSuffix } : {}),
  });
  const plannerModel = resolution.model;
  const provider = resolution.provider;
  const planned = await planRun({
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
    ...(opts.runId ? { runId: opts.runId } : {}),
    ...(opts.runIdSuffix ? { runIdSuffix: opts.runIdSuffix } : {}),
    ...(opts.initiativeIdSuffix ? { initiativeIdSuffix: opts.initiativeIdSuffix } : {}),
    persistRunArtifacts: !opts.dryRun,
  });

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
  console.log(chalk.dim(`steps: ${planned.taskGraph.steps.length}`));
  console.log(chalk.dim(`saved: .kiwi/runs/${planned.runId}/`));
}
