import {
  captureWorktreeDiffArtifact,
  executeSandboxCommand,
  SandboxCommandInput,
} from "@ai-kiwi/sandbox";
import {
  RunnerAdapter,
  RunnerExecutionInput,
  RunnerExecutionOutput,
} from "./runner-adapter";
import { createFailedRunnerOutput, zeroModelUsage } from "./runner-output";

export class LocalShellRunnerAdapter implements RunnerAdapter {
  readonly name = "local-shell";

  async execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    if (!input.command || input.command.length === 0) {
      return createFailedRunnerOutput({
        status: "blocked",
        code: "MISSING_COMMAND",
        message: "local-shell runner requires a command",
        gateStatus: "blocked",
      });
    }

    if (!input.commandPolicy) {
      return createFailedRunnerOutput({
        status: "blocked",
        code: "MISSING_COMMAND_POLICY",
        message: "local-shell runner requires a sandbox command policy",
        gateStatus: "blocked",
      });
    }

    const sandboxInput: SandboxCommandInput = {
      cwd: input.workspacePath,
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      worktreePath: input.worktreePath,
      command: input.command,
      policy: {
        ...input.commandPolicy,
        timeoutMs: Math.min(input.commandPolicy.timeoutMs, input.timeouts.commandTimeoutMs),
      },
    };

    if (input.env) sandboxInput.env = input.env;
    if (input.approved !== undefined) sandboxInput.approved = input.approved;
    if (input.requestedAt) sandboxInput.now = new Date(input.requestedAt);

    const output = await executeSandboxCommand(sandboxInput);
    const diffInput: Parameters<typeof captureWorktreeDiffArtifact>[0] = {
      cwd: input.workspacePath,
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      worktreePath: input.worktreePath,
    };
    if (input.repoPath) diffInput.sourcePath = input.repoPath;
    const diffArtifact = captureWorktreeDiffArtifact(diffInput);
    const artifactRefs = diffArtifact
      ? [...output.artifactRefs, diffArtifact]
      : output.artifactRefs;
    const rawLogsRef = output.artifactRefs[0]?.ref ?? null;
    const result: RunnerExecutionOutput = {
      status: output.status,
      artifactRefs,
      rawLogsRef,
      modelUsage: zeroModelUsage(),
      gateResult: output.gateResult,
    };

    if (output.status === "completed") {
      return result;
    }

    return {
      ...result,
      error: {
        code: `RUNNER_${output.status.toUpperCase()}`,
        message: output.stderr || output.gateResult.reason,
      },
    };
  }
}
