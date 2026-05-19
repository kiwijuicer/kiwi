import { AccessModes, RunnerName, RunnerNames } from "@kiwi/contracts";
import {
  CODEX_AUTO_REVIEW_APPROVAL_POLICY,
  CODEX_AUTO_REVIEW_APPROVALS_REVIEWER,
  CODEX_AUTO_REVIEW_SANDBOX,
  CodexCliRunner,
  DefaultCodexCliRunner,
  normalizeUsageFromCodex,
} from "./client.js";
import { cliRunnerOutput, runnerTimeoutMs } from "../../runners/cli-output.js";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../../runners/adapter.js";
import { buildRunnerEnv } from "../../runners/env.js";
import { buildContractRunnerPrompt } from "../../runners/contract-prompt.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const CODEX_ACCESS_MODE = AccessModes.CodexCli;

export interface CodexCliRunnerAdapterOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
  cliRunner?: CodexCliRunner;
  env?: Record<string, string | undefined>;
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
      prompt: buildContractRunnerPrompt(input),
      timeoutMs: runnerTimeoutMs(input, this.timeoutMs),
      env,
      sandbox: input.codexSandbox ?? CODEX_AUTO_REVIEW_SANDBOX,
      approvalPolicy: CODEX_AUTO_REVIEW_APPROVAL_POLICY,
      approvalsReviewer: CODEX_AUTO_REVIEW_APPROVALS_REVIEWER,
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
