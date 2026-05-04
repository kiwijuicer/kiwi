import { AccessModes, ContractValues, Artifact, GateResultSchema, RunnerName, RunnerNames } from "@kiwi/contracts";
import { captureDiffArtifact } from "@kiwi/sandbox";
import { ClaudeCodeCliInvocation, ClaudeCodeCliRunner, DefaultClaudeCodeCliRunner, normalizeUsageFromCli } from "./client";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../runner-adapter";
import { buildRunnerEnv } from "../runner-env";
import { persistRunnerLogs } from "../runner-logs";

const DEFAULT_TIMEOUT_MS = 600_000;
const CLAUDE_CODE_ACCESS_MODE = AccessModes.ClaudeCodeCli;

export interface ClaudeCodeRunnerAdapterOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
  cliRunner?: ClaudeCodeCliRunner;
  env?: Record<string, string | undefined>;
  allowedTools?: string[];
}

function buildPrompt(input: RunnerExecutionInput): string {
  return JSON.stringify(
    {
      request:
        "Implement the focal step in the current working directory. Make only the minimal code changes required by the success criteria. Use only allowed tools.",
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      stepPrompt: input.stepPrompt,
      contextPackage: input.contextPackage,
      worktreePath: input.worktreePath,
      allowedTools: input.allowedTools,
    },
    null,
    2,
  );
}

export class ClaudeCodeRunnerAdapter implements RunnerAdapter {
  readonly name: RunnerName = RunnerNames.ClaudeCode;
  private readonly binary: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly cliRunner: ClaudeCodeCliRunner;
  private readonly env: Record<string, string | undefined>;
  private readonly allowedTools: string[];

  constructor(options: ClaudeCodeRunnerAdapterOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CLAUDE_CODE_BINARY ?? "claude";
    this.model = options.model ?? "claude-sonnet-4-6";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cliRunner = options.cliRunner ?? new DefaultClaudeCodeCliRunner();
    this.env = options.env ?? process.env;
    this.allowedTools = options.allowedTools ?? ["Read", "Write", "Edit", "Bash"];
  }

  async execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    const prompt = buildPrompt(input);
    const env = buildRunnerEnv({
      sourceEnv: this.env,
      inputEnv: input.env,
      policy: input.commandPolicy,
    });
    const invocation: ClaudeCodeCliInvocation = {
      binary: this.binary,
      cwd: input.worktreePath,
      model: this.model,
      prompt,
      outputFormat: "json",
      allowedTools: this.allowedTools,
      timeoutMs: Math.min(this.timeoutMs, Math.max(input.timeouts.commandTimeoutMs, 60_000) * 5),
      env,
    };
    const result = await this.cliRunner.run(invocation);
    const usage = normalizeUsageFromCli(result.parsed);
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

    if (result.timedOut) {
      return {
        status: ContractValues.Failed,
        artifactRefs,
        rawLogsRef: logsArtifact.ref,
        modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        modelId: this.model,
        providerName: CLAUDE_CODE_ACCESS_MODE,
        accessMode: CLAUDE_CODE_ACCESS_MODE,
        usagePrecision: usage.precision,
        estimatedCostUsd: usage.estimatedCostUsd,
        gateResult: GateResultSchema.parse({
          gateId: "gate_runner_execution",
          gateType: "forbidden_file_checks",
          status: ContractValues.Fail,
          evidenceRefs: [],
          reason: `claude-code runner timed out after ${invocation.timeoutMs}ms`,
        }),
        error: {
          code: "RUNNER_TIMEOUT",
          message: `claude-code runner timed out after ${invocation.timeoutMs}ms`,
        },
      };
    }

    if (!result.ok) {
      return {
        status: ContractValues.Failed,
        artifactRefs,
        rawLogsRef: logsArtifact.ref,
        modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        modelId: this.model,
        providerName: CLAUDE_CODE_ACCESS_MODE,
        accessMode: CLAUDE_CODE_ACCESS_MODE,
        usagePrecision: usage.precision,
        estimatedCostUsd: usage.estimatedCostUsd,
        gateResult: GateResultSchema.parse({
          gateId: "gate_runner_execution",
          gateType: "forbidden_file_checks",
          status: ContractValues.Fail,
          evidenceRefs: [],
          reason: `claude-code runner exited ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        }),
        error: {
          code: `RUNNER_EXIT_${result.exitCode ?? "UNKNOWN"}`,
          message: result.stderr.slice(0, 500) || "claude-code runner failed",
        },
      };
    }

    return {
      status: ContractValues.Completed,
      artifactRefs,
      rawLogsRef: logsArtifact.ref,
      modelUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      modelId: this.model,
      providerName: CLAUDE_CODE_ACCESS_MODE,
      accessMode: CLAUDE_CODE_ACCESS_MODE,
      usagePrecision: usage.precision,
      estimatedCostUsd: usage.estimatedCostUsd,
      gateResult: GateResultSchema.parse({
        gateId: "gate_runner_execution",
        gateType: "forbidden_file_checks",
        status: ContractValues.Pass,
        evidenceRefs: [],
        reason: diffArtifact ? "claude-code runner produced diff" : "claude-code runner completed without changes",
      }),
    };
  }
}
