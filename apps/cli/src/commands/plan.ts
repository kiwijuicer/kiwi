import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { ModelEntry } from "@ai-kiwi/contracts";
import {
  PlannerProviderInput,
  StubPlannerProvider,
  runPlannerProviderWithRetries,
} from "@ai-kiwi/adapters";
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

function selectPlannerModel(models: ModelEntry[]): ModelEntry {
  const candidate = models.find(
    (model) => model.enabled && model.roles.includes("planner") && model.capability === "frontier",
  ) ?? models.find((model) => model.enabled && model.roles.includes("planner"));

  if (!candidate) {
    throw new Error("No enabled planner model found in model-registry.yaml");
  }

  return candidate;
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
  const registry = loadRegistry(path.join(cwd, "model-registry.yaml"));

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
  const plannerModel = selectPlannerModel(registry.models);
  if (plannerModel.provider !== "stub") {
    throw new Error(
      `Planner provider '${plannerModel.provider}' is not supported yet. Use a stub planner model.`,
    );
  }

  const plannerInput: PlannerProviderInput = {
    runId,
    initiative,
    policy,
    requestedAt: now.toISOString(),
  };
  const provider = new StubPlannerProvider({
    buildTaskGraph: buildDeterministicTaskGraph,
    now: () => now,
    ...(opts.planIdSuffix ? { planIdSuffix: opts.planIdSuffix } : {}),
  });
  const plannerOutput = await runPlannerProviderWithRetries(provider, plannerInput, {
    maxAttempts: 2,
  });
  const taskGraph = plannerOutput.taskGraph;

  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          runId,
          initiative,
          plannerModelId: plannerModel.id,
          taskGraph,
          plannerInput,
          plannerOutput,
        },
        null,
        2,
      ),
    );
    return;
  }

  savePlannedRun({
    runId,
    initiative,
    taskGraph,
    plannerInput,
    plannerOutput: {
      plannerModelId: plannerModel.id,
      ...plannerOutput,
    },
    cwd,
    now,
  });

  console.log(chalk.green("✓") + " Run planned");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`steps: ${taskGraph.steps.length}`));
  console.log(chalk.dim(`saved: .kiwi/runs/${runId}/`));
}
