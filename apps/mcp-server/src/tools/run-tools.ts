import { ContractValues } from "@kiwi/contracts";
import { type RunExecutionPreview, splitCommandLine } from "@kiwi/runtime";
import { withOperatorCard } from "../ux/operator-card.js";
import {
  consumeMcpPreviewToken,
  createMcpPreviewToken,
  normalizePreviewInput,
  validateMcpPreviewToken,
} from "./preview-tokens.js";
import { runStepToolUnlocked } from "./run-step-execution.js";
import { previewConfirmationSummary, type ToolCallOptions } from "./helpers.js";
import { mutationScope, safeReadOnlyToolCalls } from "../ux/index.js";
import { getMcpServerServices } from "../services.js";
import { workspaceArgs } from "../workspace/index.js";
import {
  assertMcpCommandOverrideAllowed,
  assertMcpDirectExecutionSafe,
  blockedPreviewAction,
  executeRunToolLocked,
  nextRunAction,
  previewFromRecord,
  previewStepViews,
} from "./run-tool-internals.js";

function services(): ReturnType<typeof getMcpServerServices> {
  return getMcpServerServices();
}

export function previewRunTool(args: Record<string, unknown>, cwd: string): unknown {
  const runId = String(args.runId ?? "");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = args.maxConcurrency as number | undefined;
  const command = typeof args.command === "string" ? args.command : undefined;
  const previewInput = normalizePreviewInput({ fromStep, maxConcurrency, command });
  const preview = services().runtime.execution.previews.build({
    cwd: workspace.workspacePath,
    runId,
    ...(fromStep ? { fromStep } : {}),
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    ...(command ? { command: splitCommandLine(command) } : {}),
  });

  if (preview.executionIsolation === "direct") {
    const initiative = services().core.runs.loadInitiative(runId, workspace.workspacePath);
    assertMcpDirectExecutionSafe({
      workspacePath: workspace.workspacePath,
      repoPath: initiative.repoPath || workspace.workspacePath,
      runId,
    });
  }
  assertMcpCommandOverrideAllowed({
    args,
    workspacePath: workspace.workspacePath,
    runId,
  });
  const token = createMcpPreviewToken({
    cwd: workspace.workspacePath,
    runId,
    preview,
    previewInput,
  });
  const estimatedCostUsd = preview.steps.reduce((sum, step) => sum + step.estimatedAttemptCostUsd, 0);
  const blockedSteps = preview.steps.filter((step) => step.status === ContractValues.Blocked);
  const nextAction =
    blockedSteps.length > 0
      ? blockedPreviewAction({
          workspacePath: workspace.workspacePath,
          repoId: workspace.repo?.id,
          repoPath: workspace.repo?.path,
          runId,
          blockedSteps,
          fromStep,
          maxConcurrency: previewInput.maxConcurrency,
          command,
          maxConcurrencyExplicit: previewInput.maxConcurrencyExplicit,
        })
      : nextRunAction({
          workspacePath: workspace.workspacePath,
          repoId: workspace.repo?.id,
          repoPath: workspace.repo?.path,
          runId,
          previewToken: token.token,
          fromStep,
          maxConcurrency: previewInput.maxConcurrency,
          command,
          maxConcurrencyExplicit: previewInput.maxConcurrencyExplicit,
        });
  const runScope = mutationScope({
    riskLabel: "MUTATES_WORKTREE",
    workspacePath: workspace.workspacePath,
    repoPath: token.repoPath,
    executionMode: preview.executionIsolation,
  });
  const previewScope = mutationScope({
    riskLabel: "WRITES_RUN_ARTIFACTS",
    workspacePath: workspace.workspacePath,
    repoPath: token.repoPath,
    executionMode: preview.executionIsolation,
  });

  return withOperatorCard(
    {
      schemaVersion: "2",
      kind: "run_execution_preview",
      previewToken: token.token,
      previewResource: `kiwi://runs/${runId}/previews/${token.token}`,
      runId,
      workspace: {
        workspacePath: workspace.workspacePath,
        repoId: workspace.repo?.id ?? null,
        repoPath: token.repoPath,
      },
      decision: {
        requiresUserConfirmation: blockedSteps.length === 0,
        confirmationSummary:
          blockedSteps.length > 0
            ? `Cannot execute ${blockedSteps.length} blocked step(s): ${blockedSteps.map((step) => step.stepId).join(", ")}.`
            : previewConfirmationSummary({
                stepCount: preview.steps.length,
                repoPath: token.repoPath,
                executionIsolation: preview.executionIsolation,
                estimatedCostUsd,
                command: previewInput.command,
              }),
        nextAction,
      },
      execution: {
        owner: preview.executionOwner,
        isolation: preview.executionIsolation,
        maxConcurrency: preview.maxConcurrency,
        subPlans: preview.subPlans,
        mutationScope: runScope,
      },
      cost: {
        estimatedCostUsd,
        currency: "USD",
      },
      steps: previewStepViews(preview),
      safeAlternatives: safeReadOnlyToolCalls({ workspacePath: workspace.workspacePath, runId }),
    },
    {
      cwd: workspace.workspacePath,
      runId,
      lastAction: "kiwi_preview_run",
      nextAction,
      mutationScope: previewScope,
    },
  );
}

export async function runStepTool(
  args: Record<string, unknown>,
  cwd: string,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const stepId = String(args.stepId ?? "");
  const workspace = workspaceArgs(args, cwd, false);

  return services().core.locks.withLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: `mcp_run_step:${stepId}`,
    },
    async () => {
      const previewRecord = validateMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        previewToken: typeof args.previewToken === "string" ? args.previewToken : undefined,
        stepId,
        expectedCommand: typeof args.command === "string" ? args.command : null,
      });

      if (previewRecord.executionIsolation === "direct") {
        assertMcpDirectExecutionSafe({
          workspacePath: workspace.workspacePath,
          repoPath: previewRecord.repoPath,
          runId,
        });
      }
      assertMcpCommandOverrideAllowed({ args, workspacePath: workspace.workspacePath, runId });
      const preview: RunExecutionPreview = previewFromRecord({
        workspacePath: workspace.workspacePath,
        runId,
        previewInput: previewRecord.previewInput,
      });
      const previewStep = preview.steps.find((step) => step.stepId === stepId) ?? null;
      consumeMcpPreviewToken({
        cwd: workspace.workspacePath,
        runId,
        record: previewRecord,
        stepId,
      });
      const result = await runStepToolUnlocked(args, workspace.workspacePath, options, {
        stepIndex: 1,
        stepCount: 1,
        previewStep,
      });

      return withOperatorCard(
        {
          schemaVersion: "2",
          kind: "step_execution_result",
          runId,
          stepId,
          attempt: {
            attemptId: result.attemptId,
            status: result.status,
            nextAction: result.nextAction,
          },
          runStatus: result.runStatus,
          materializedDiff: result.materializedDiff,
        },
        {
          cwd: workspace.workspacePath,
          runId,
          lastAction: "kiwi_run_step",
          mutationScope: mutationScope({
            riskLabel: "MUTATES_WORKTREE",
            workspacePath: workspace.workspacePath,
            repoPath: workspace.repo?.path ?? null,
            executionMode: null,
          }),
        },
      );
    },
  );
}

export async function runTool(
  args: Record<string, unknown>,
  cwd: string,
  callOptions: ToolCallOptions = {},
): Promise<unknown> {
  const runId = String(args.runId ?? "");
  const workspace = workspaceArgs(args, cwd, false);
  const fromStep = typeof args.fromStep === "string" ? args.fromStep : undefined;
  const maxConcurrency = args.maxConcurrency as number | undefined;

  return services().core.locks.withLock(
    {
      cwd: workspace.workspacePath,
      runId,
      operation: "mcp_run",
    },
    async () =>
      executeRunToolLocked({
        args,
        workspacePath: workspace.workspacePath,
        repoPath: workspace.repo?.path ?? null,
        runId,
        fromStep,
        maxConcurrency,
        callOptions,
      }),
  );
}
