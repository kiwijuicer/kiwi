import { AccessModes, RunnerName, RunnerNames } from "@kiwi/contracts";
import {
  CursorAgentCliInvocation,
  CursorAgentCliRunner,
  DefaultCursorAgentCliRunner,
  normalizeUsageFromCursorAgent,
} from "./client";
import { cliRunnerOutput, runnerTimeoutMs } from "../../runners/cli-output";
import { RunnerAdapter, RunnerExecutionInput, RunnerExecutionOutput } from "../../runners/adapter";
import { buildRunnerEnv } from "../../runners/env";
import { buildContractRunnerPrompt } from "../../runners/contract-prompt";

const DEFAULT_TIMEOUT_MS = 600_000;
const CURSOR_AGENT_ACCESS_MODE = AccessModes.CursorAgentCli;

export interface CursorAgentRunnerAdapterOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
  cliRunner?: CursorAgentCliRunner;
  env?: Record<string, string | undefined>;
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
      prompt: buildContractRunnerPrompt(input, { includeWorktreePath: true }),
      outputFormat: "json",
      timeoutMs: runnerTimeoutMs(input, this.timeoutMs),
      env,
    };

    if (this.model) {
      invocation.model = this.model;
    }

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
