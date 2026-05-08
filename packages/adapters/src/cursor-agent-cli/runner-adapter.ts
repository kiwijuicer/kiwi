import { AccessModes, RunnerName, RunnerNames } from "@kiwi/contracts";
import {
  CursorAgentCliInvocation,
  CursorAgentCliRunner,
  DefaultCursorAgentCliRunner,
  normalizeUsageFromCursorAgent,
} from "./client";
import { cliRunnerOutput, runnerTimeoutMs } from "../cli-runner-output";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../runner-adapter";
import { buildRunnerEnv } from "../runner-env";

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
        doNotModifyMainWorkspace: input.executionMode !== "direct",
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
      timeoutMs: runnerTimeoutMs(input, this.timeoutMs),
      env,
    };
    if (this.model) invocation.model = this.model;

    const result = await this.cliRunner.run(invocation);
    const usage = normalizeUsageFromCursorAgent(result.parsed);
    return cliRunnerOutput({
      input,
      runnerName: this.name,
      result,
      usage,
      modelId: this.model ?? null,
      providerName: CURSOR_AGENT_ACCESS_MODE,
      timeoutMs: invocation.timeoutMs,
      label: "cursor-agent",
    });
  }
}
