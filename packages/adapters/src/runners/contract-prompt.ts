import { MutationRequirements } from "@kiwi/contracts";
import type { RunnerExecutionInput } from "./adapter.js";

const DEFAULT_REQUEST =
  "Implement only the contracted step in this working directory. Satisfy acceptance criteria and leave an inspectable working-tree diff when file changes are required.";

interface ContractRunnerPromptOptions {
  includeWorktreePath?: boolean;
  request?: string;
}

export function buildContractRunnerPrompt(
  input: RunnerExecutionInput,
  options: ContractRunnerPromptOptions = {},
): string {
  const payload = {
    request: options.request ?? DEFAULT_REQUEST,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    step: input.step,
    taskContract: input.contextPackage.task,
    initiative: input.contextPackage.initiative,
    mutationRequirement: input.contextPackage.mutationRequirement,
    files: input.contextPackage.files,
    commands: input.contextPackage.commands,
    budget: input.contextPackage.budget,
    ...(options.includeWorktreePath ? { worktreePath: input.worktreePath } : {}),
    expectedDiff:
      input.contextPackage.mutationRequirement === MutationRequirements.MustChangeFiles
        ? "Required. Do not report success without file changes in the worktree."
        : "Allowed only when needed by the task contract.",
    allowedTools: input.allowedTools,
    safety: {
      doNotCommit: true,
      doNotPush: true,
      doNotModifyMainWorkspace: input.executionMode !== "direct",
      noUnrelatedChanges: true,
      runGateCommandsOnlyWhenNecessary: true,
    },
  };

  return JSON.stringify(payload, null, 2);
}
