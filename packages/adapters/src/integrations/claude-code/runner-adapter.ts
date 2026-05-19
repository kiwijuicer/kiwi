import { AccessModes, RunnerName, RunnerNames } from "@kiwi/contracts";
import {
  ClaudeCodeCliInvocation,
  ClaudeCodeCliRunner,
  DefaultClaudeCodeCliRunner,
  normalizeUsageFromCli,
} from "./client.js";
import { cliRunnerOutput, runnerTimeoutMs } from "../../runners/cli-output.js";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../../runners/adapter.js";
import { buildRunnerEnv } from "../../runners/env.js";
import { buildContractRunnerPrompt } from "../../runners/contract-prompt.js";

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

export class ClaudeCodeRunnerAdapter implements RunnerAdapter {
  readonly name: RunnerName = RunnerNames.ClaudeCode;
  private readonly binary: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly cliRunner: ClaudeCodeCliRunner;
  private readonly env: Record<string, string | undefined>;
  private readonly allowedTools: string[];

  constructor(options: ClaudeCodeRunnerAdapterOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CLAUDE_CODE_BINARY ?? "claude";
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cliRunner = options.cliRunner ?? new DefaultClaudeCodeCliRunner();
    this.env = options.env ?? process.env;
    this.allowedTools = options.allowedTools ?? ["Read", "Write", "Edit"];
  }

  async execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput> {
    const prompt = buildContractRunnerPrompt(input, { includeWorktreePath: true });
    const env = buildRunnerEnv({
      sourceEnv: this.env,
      inputEnv: input.env,
      policy: input.commandPolicy,
    });
    const invocation: ClaudeCodeCliInvocation = {
      binary: this.binary,
      cwd: input.worktreePath,
      ...(this.model ? { model: this.model } : {}),
      prompt,
      outputFormat: "json",
      allowedTools: this.allowedTools,
      timeoutMs: runnerTimeoutMs(input, this.timeoutMs),
      env,
    };
    const result = await this.cliRunner.run(invocation);
    const usage = normalizeUsageFromCli(result.parsed);

    return cliRunnerOutput({
      input,
      runnerName: this.name,
      result,
      usage,
      modelId: this.model ?? null,
      providerName: CLAUDE_CODE_ACCESS_MODE,
      timeoutMs: invocation.timeoutMs,
      label: "claude-code",
    });
  }
}
