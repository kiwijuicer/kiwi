import { AccessModes, Artifact, ContractValues, GateResultSchema, RunnerName, RunnerNames } from "@kiwi/contracts";
import { captureDiffArtifact } from "@kiwi/sandbox";
import {
  CursorAgentCliInvocation,
  CursorAgentCliRunner,
  DefaultCursorAgentCliRunner,
  normalizeUsageFromCursorAgent,
} from "./client";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../runner-adapter";
import { buildRunnerEnv } from "../runner-env";
import { persistRunnerLogs } from "../runner-logs";

const DEFAULT_TIMEOUT_MS = 600_000;
const CURSOR_AGENT_ACCESS_MODE = AccessModes.CursorAgentCli;

export interface CursorAgentRunnerAdapterOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
  cliRunner?: CursorAgentCliRunner;
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
      worktreePath: input.worktreePath,
      successCriteria: Array.isArray((input.contextPackage as { successCriteria?: unknown }).successCriteria)
        ? (input.contextPackage as { successCriteria: unknown[] }).successCriteria
        : [],
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

export class CursorAgentRunnerAdapter implements RunnerAdapter {
  readonly name: RunnerName = RunnerNames.CursorAgent;
  private readonly binary: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly cliRunner: CursorAgentCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CursorAgentRunnerAdapterOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CURSOR_AGENT_BINARY ?? "cursor-agent";
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cliRunner = options.cliRunner ?? new DefaultCursorAgentCliRunner();
    this.env = options.env ?? process.env;
  }

  async execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    const env = buildRunnerEnv({
      sourceEnv: this.env,
      inputEnv: input.env,
      policy: input.commandPolicy,
    });
    const invocation: CursorAgentCliInvocation = {
      binary: this.binary,
      cwd: input.worktreePath,
      prompt: buildPrompt(input),
      outputFormat: "json",
      timeoutMs: Math.min(this.timeoutMs, Math.max(input.timeouts.commandTimeoutMs, 60_000) * 5),
      env,
    };
    if (this.model) invocation.model = this.model;

    const result = await this.cliRunner.run(invocation);
    const usage = normalizeUsageFromCursorAgent(result.parsed);
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
      providerName: CURSOR_AGENT_ACCESS_MODE,
      accessMode: CURSOR_AGENT_ACCESS_MODE,
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
          reason: `cursor-agent runner timed out after ${invocation.timeoutMs}ms`,
        }),
        error: {
          code: "RUNNER_TIMEOUT",
          message: `cursor-agent runner timed out after ${invocation.timeoutMs}ms`,
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
          reason: `cursor-agent runner exited ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        }),
        error: {
          code: `RUNNER_EXIT_${result.exitCode ?? "UNKNOWN"}`,
          message: result.stderr.slice(0, 500) || "cursor-agent runner failed",
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
        reason: diffArtifact ? "cursor-agent runner produced diff" : "cursor-agent runner completed without changes",
      }),
    };
  }
}
