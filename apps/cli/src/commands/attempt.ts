import path from "path";
import chalk from "chalk";
import { Artifact, GateResult, GateResultSchema, GateType, GateTypeSchema } from "@kiwi/contracts";
import { LocalShellRunnerAdapter } from "@kiwi/adapters";
import { createWorktreeSandbox, executeSandboxCommand, SandboxCommandPolicy } from "@kiwi/sandbox";
import {
  assertStepDependenciesCompleted,
  commandForGate,
  commandProfileForStep,
  commandProfileToExecutionPolicy,
  loadApprovalDecision,
  loadInitiative,
  loadPolicy,
  loadTaskGraph,
  noopCommand,
  refreshRunStatusFromAttempts,
  scheduleStepAttempt,
  splitCommandLine,
  StepAttemptOrchestrator,
  withRunLock,
} from "@kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

export interface AttemptOptions extends CliWorkspaceOptions {
  command?: string;
  approved?: boolean;
  attemptId?: string;
  now?: Date;
}

function safeGateType(value: string): GateType | null {
  const parsed = GateTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function passPolicyGate(gateType: GateType): GateResult {
  return GateResultSchema.parse({
    gateId: `gate_${gateType}`,
    gateType,
    status: "pass",
    evidenceRefs: [],
    reason: `${gateType} satisfied by policy precheck`,
  });
}

async function runRequiredGates(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  policy: ReturnType<typeof loadPolicy>;
  requiredGates: string[];
  approved: boolean;
  now?: Date;
}): Promise<{ gateResults: GateResult[]; artifacts: Artifact[] }> {
  const profile = commandProfileForStep(params.policy, "validation");
  const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
  const gateResults: GateResult[] = [];
  const artifacts: Artifact[] = [];

  for (const gate of params.requiredGates) {
    const gateType = safeGateType(gate);
    if (!gateType) continue;
    const command = commandForGate(params.policy, gateType);
    if (!command) {
      if (gateType === "forbidden_file_checks" || gateType === "secrets_check") {
        gateResults.push(passPolicyGate(gateType));
      }
      continue;
    }

    const gateInput: Parameters<typeof executeSandboxCommand>[0] = {
      cwd: params.cwd,
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      worktreePath: params.worktreePath,
      command,
      policy: commandPolicy,
      approved: params.approved,
      gateId: `gate_${gateType}`,
      gateType,
      artifactLabel: gateType,
    };
    if (params.now) gateInput.now = params.now;
    const output = await executeSandboxCommand(gateInput);
    gateResults.push(output.gateResult);
    artifacts.push(...output.artifactRefs);
  }

  return { gateResults, artifacts };
}

export async function runAttemptUnlocked(
  runId: string,
  stepId: string,
  opts: AttemptOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const policy = loadPolicy(path.join(cwd, "kiwi-policy.yaml"));
  const initiative = loadInitiative(runId, cwd);
  const repoPath = initiative.repoPath || cwd;
  const taskGraph = loadTaskGraph(runId, cwd);
  const step = taskGraph.steps.find((entry) => entry.stepId === stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);
  assertStepDependenciesCompleted({
    cwd,
    runId,
    stepId,
    dependsOn: step.dependsOn,
  });

  const now = opts.now ?? new Date();
  const decision = scheduleStepAttempt({
    cwd,
    runId,
    step,
    initiative,
    budgetProfile: initiative.budgetProfile,
    budgetRemainingUsdEstimate: null,
    blastRadius: initiative.riskProfile === "production" ? "high" : "low",
    securitySensitivity: initiative.riskProfile === "production" ? "high" : "low",
    contextSize: "small",
    runnerAvailability: ["local-shell"],
    now,
    ...(opts.attemptId ? { attemptId: opts.attemptId } : {}),
  });
  if (decision.status !== "scheduled") {
    throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
  }

  const approval = loadApprovalDecision({ cwd, runId, attemptId: decision.attemptId });
  const approved = opts.approved ?? approval?.state === "auto";
  const sandbox = createWorktreeSandbox({
    cwd,
    runId,
    attemptId: decision.attemptId,
    sourcePath: repoPath,
  });
  const gateEvidence = await runRequiredGates({
    cwd,
    runId,
    stepId,
    attemptId: decision.attemptId,
    worktreePath: sandbox.worktreePath,
    policy,
    requiredGates: decision.requiredGates,
    approved,
    now,
  });

  const profile = commandProfileForStep(policy, step.type);
  const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
  const command = opts.command ? splitCommandLine(opts.command) : noopCommand();
  const result = await new StepAttemptOrchestrator<SandboxCommandPolicy>().execute({
    cwd,
    repoPath,
    step,
    schedulerDecision: decision,
    runner: new LocalShellRunnerAdapter(),
    worktreePath: sandbox.worktreePath,
    stepPrompt: step.title,
    allowedTools: ["shell"],
    command,
    commandPolicy,
    approved,
    additionalGateResults: gateEvidence.gateResults,
    additionalArtifacts: gateEvidence.artifacts,
    now,
  });
  const run = refreshRunStatusFromAttempts({ cwd, runId, now: new Date() });

  console.log(chalk.green("✓") + " Step attempted");
  console.log(chalk.dim(`runId: ${runId}`));
  console.log(chalk.dim(`stepId: ${stepId}`));
  console.log(chalk.dim(`attemptId: ${decision.attemptId}`));
  console.log(chalk.dim(`status: ${result.status}`));
  console.log(chalk.dim(`nextAction: ${result.nextAction.type}`));
  console.log(chalk.dim(`runStatus: ${run.status}`));
}

export async function runAttempt(
  runId: string,
  stepId: string,
  opts: AttemptOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  await withRunLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `attempt:${stepId}`,
      now: opts.now,
    },
    () => runAttemptUnlocked(runId, stepId, opts, workspace.workspacePath),
  );
}
