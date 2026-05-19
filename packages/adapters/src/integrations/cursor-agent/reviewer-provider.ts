import { AccessModes, KiwiPolicy } from "@kiwi/contracts";
import type { ProviderAttemptType } from "../../constants.js";
import { CliPlannerResult } from "../../providers/cli-planner.js";
import { emptyReviewerPolicy, invokeCliReviewer } from "../../providers/cli-reviewer.js";
import {
  ReviewerProvider,
  ReviewerProviderInput,
  ReviewerProviderOutput,
  ReviewerProviderRepairContext,
} from "../../providers/reviewer.js";
import { CursorAgentCliRunner, DefaultCursorAgentCliRunner, normalizeUsageFromCursorAgent } from "./client.js";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CursorAgentReviewerProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  runner?: CursorAgentCliRunner;
  env?: Record<string, string | undefined>;
  policy?: KiwiPolicy;
}

export class CursorAgentReviewerProvider implements ReviewerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CursorAgentCliRunner;
  private readonly env: Record<string, string | undefined>;
  private readonly policy: KiwiPolicy;

  constructor(options: CursorAgentReviewerProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CURSOR_AGENT_BINARY ?? "cursor-agent";
    if (options.cwd !== undefined) {
      this.cwd = options.cwd;
    }
    this.model = options.model;
    this.name = `cursor-agent-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.runner = options.runner ?? new DefaultCursorAgentCliRunner();
    this.env = options.env ?? process.env;
    this.policy = options.policy ?? emptyReviewerPolicy();
  }

  async review(input: ReviewerProviderInput): Promise<ReviewerProviderOutput> {
    return this.invoke(input, "initial");
  }

  async repair(input: ReviewerProviderInput, context: ReviewerProviderRepairContext): Promise<ReviewerProviderOutput> {
    return this.invoke(input, "repair", context);
  }

  private async invoke(
    input: ReviewerProviderInput,
    attemptType: ProviderAttemptType,
    context?: ReviewerProviderRepairContext,
  ): Promise<ReviewerProviderOutput> {
    return invokeCliReviewer({
      providerName: this.name,
      label: "cursor-agent-cli",
      accessMode: AccessModes.CursorAgentCli,
      binary: this.binary,
      model: this.model,
      input,
      attemptType,
      ...(context ? { context } : {}),
      env: this.env,
      policy: this.policy,
      timeoutMs: this.timeoutMs,
      normalizeUsage: normalizeUsageFromCursorAgent,
      run: (prompt, env): Promise<CliPlannerResult> =>
        this.runner.run({
          binary: this.binary,
          cwd: this.cwd ?? process.cwd(),
          ...(this.model ? { model: this.model } : {}),
          prompt,
          outputFormat: "json",
          timeoutMs: this.timeoutMs,
          env,
        }),
    });
  }
}
