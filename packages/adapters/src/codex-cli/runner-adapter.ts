import { AccessModes, Artifact, ContractValues, GateResultSchema, RunnerName, RunnerNames } from "@kiwi/contracts";
import { captureDiffArtifact } from "@kiwi/sandbox";
import { CodexCliRunner, DefaultCodexCliRunner, normalizeUsageFromCodex } from "./client";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../runner-adapter";
import { buildRunnerEnv } from "../runner-env";
import { persistRunnerLogs } from "../runner-logs";

const DEFAULT_TIMEOUT_MS = 600_000;
const CODEX_ACCESS_MODE = AccessModes.CodexCli;

export interface CodexCliRunnerAdapterOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
  cliRunner?: CodexCliRunner;
  env?: Record<string, string | undefined>;
}

function buildPrompt(input: RunnerExecutionInput): string {
  return JSON.stringify(
    {
      request:
        "Implement the focal step in this working directory. Keep the change minimal, satisfy success criteria, and stop with an inspectable working-tree diff.",
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      stepPrompt: input.stepPrompt,
      contextPackage: input.contextPackage,
      allowedTools: input.allowedTools,
      safety: {
        doNotCommit: true,
        doNotPush: true,
        doNotModifyMainWorkspace: true,
      },
    },
    null,
    2,
  );
}

export class CodexCliRunnerAdapter implements RunnerAdapter {
  readonly name: RunnerName = RunnerNames.Codex;
  private readonly binary: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly cliRunner: CodexCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CodexCliRunnerAdapterOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CODEX_BINARY ?? "codex";
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cliRunner = options.cliRunner ?? new DefaultCodexCliRunner();
    this.env = options.env ?? process.env;
  }

  async execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    const env = buildRunnerEnv({
      sourceEnv: this.env,
      inputEnv: input.env,
      policy: input.commandPolicy,
    });
    const invocation = {
      binary: this.binary,
      cwd: input.worktreePath,
      prompt: buildPrompt(input),
      timeoutMs: Math.min(this.timeoutMs, Math.max(input.timeouts.commandTimeoutMs, 60_000) * 5),
      env,
      ...(this.model ? { model: this.model } : {}),
    };
    const result = await this.cliRunner.run(invocation);
    const usage = normalizeUsageFromCodex(result.parsed);
    const logsArtifact = persistRunnerLogs({
      workspacePath: input.workspacePath,
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      runner: this.name,
      payload: {
        binary: result.binary,
        args: result.args,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      },
      secretValues: input.commandPolicy?.secretValues,
    });
    const diffInput: Parameters<typeof captureDiffArtifact>[0] = {
      cwd: input.workspacePath,
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      worktreePath: input.worktreePath,
    };
    if (input.repoPath) diffInput.sourcePath = input.repoPath;
    const diffArtifact = captureDiffArtifact(diffInput);
    const artifactRefs: Artifact[] = diffArtifact ? [logsArtifact, diffArtifact] : [logsArtifact];
    const baseOutput = {
      artifactRefs,
      rawLogsRef: logsArtifact.ref,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      modelId: this.model ?? null,
      providerName: CODEX_ACCESS_MODE,
      accessMode: CODEX_ACCESS_MODE,
      usagePrecision: usage.precision,
      estimatedCostUsd: usage.estimatedCostUsd,
    };

    if (result.timedOut) {
      return {
        ...baseOutput,
        status: "timeout",
        gateResult: GateResultSchema.parse({
          gateId: "gate_runner_execution",
          gateType: "forbidden_file_checks",
          status: ContractValues.Fail,
          evidenceRefs: [logsArtifact.ref],
          reason: `codex runner timed out after ${invocation.timeoutMs}ms`,
        }),
        error: {
          code: "RUNNER_TIMEOUT",
          message: `codex runner timed out after ${invocation.timeoutMs}ms`,
        },
      };
    }

    if (!result.ok) {
      return {
        ...baseOutput,
        status: ContractValues.Failed,
        gateResult: GateResultSchema.parse({
          gateId: "gate_runner_execution",
          gateType: "forbidden_file_checks",
          status: ContractValues.Fail,
          evidenceRefs: [logsArtifact.ref],
          reason: `codex runner exited ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        }),
        error: {
          code: `RUNNER_EXIT_${result.exitCode ?? "UNKNOWN"}`,
          message: result.stderr.slice(0, 500) || "codex runner failed",
        },
      };
    }

    return {
      ...baseOutput,
      status: ContractValues.Completed,
      gateResult: GateResultSchema.parse({
        gateId: "gate_runner_execution",
        gateType: "forbidden_file_checks",
        status: ContractValues.Pass,
        evidenceRefs: [logsArtifact.ref],
        reason: diffArtifact ? "codex runner produced diff" : "codex runner completed without changes",
      }),
    };
  }
}
