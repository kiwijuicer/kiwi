import { AccessModes, RunnerName, RunnerNames } from "@kiwi/contracts";
import { CodexCliRunner, DefaultCodexCliRunner, normalizeUsageFromCodex } from "./client";
import { cliRunnerOutput, runnerTimeoutMs } from "../cli-runner-output";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../runner-adapter";
import { buildRunnerEnv } from "../runner-env";

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
      timeoutMs: runnerTimeoutMs(input, this.timeoutMs),
      env,
      ...(this.model ? { model: this.model } : {}),
    };
    const result = await this.cliRunner.run(invocation);
    const usage = normalizeUsageFromCodex(result.parsed);
    return cliRunnerOutput({
      input,
      runnerName: this.name,
      result,
      usage,
      modelId: this.model ?? null,
      providerName: CODEX_ACCESS_MODE,
      timeoutMs: invocation.timeoutMs,
      label: "codex",
    });
  }
}
