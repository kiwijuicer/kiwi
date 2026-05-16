import { AccessModes, KiwiPolicy } from "@kiwi/contracts";
import type { ProviderAttemptType } from "../constants";
import { CliPlannerResult } from "../cli-planner-provider";
import { emptyReviewerPolicy, invokeCliReviewer } from "../cli-reviewer-provider";
import {
  ReviewerProvider,
  ReviewerProviderInput,
  ReviewerProviderOutput,
  ReviewerProviderRepairContext,
} from "../reviewer-provider";
import {
  CODEX_AUTO_REVIEW_APPROVAL_POLICY,
  CODEX_AUTO_REVIEW_APPROVALS_REVIEWER,
  CODEX_AUTO_REVIEW_SANDBOX,
  CodexCliRunner,
  DefaultCodexCliRunner,
  normalizeUsageFromCodex,
} from "./client";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CodexCliReviewerProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  runner?: CodexCliRunner;
  env?: Record<string, string | undefined>;
  policy?: KiwiPolicy;
}

export class CodexCliReviewerProvider implements ReviewerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CodexCliRunner;
  private readonly env: Record<string, string | undefined>;
  private readonly policy: KiwiPolicy;

  constructor(options: CodexCliReviewerProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CODEX_BINARY ?? "codex";
    if (options.cwd !== undefined) {
      this.cwd = options.cwd;
    }
    this.model = options.model;
    this.name = `codex-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.runner = options.runner ?? new DefaultCodexCliRunner();
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
      label: "codex-cli",
      accessMode: AccessModes.CodexCli,
      binary: this.binary,
      model: this.model,
      input,
      attemptType,
      ...(context ? { context } : {}),
      env: this.env,
      policy: this.policy,
      timeoutMs: this.timeoutMs,
      normalizeUsage: normalizeUsageFromCodex,
      run: (prompt, env): Promise<CliPlannerResult> =>
        this.runner.run({
          binary: this.binary,
          cwd: this.cwd ?? process.cwd(),
          ...(this.model ? { model: this.model } : {}),
          sandbox: CODEX_AUTO_REVIEW_SANDBOX,
          approvalPolicy: CODEX_AUTO_REVIEW_APPROVAL_POLICY,
          approvalsReviewer: CODEX_AUTO_REVIEW_APPROVALS_REVIEWER,
          prompt,
          timeoutMs: this.timeoutMs,
          env,
        }),
    });
  }
}
