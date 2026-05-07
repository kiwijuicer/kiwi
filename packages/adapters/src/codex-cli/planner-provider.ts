import { AccessModes } from "@kiwi/contracts";
import { CliPlannerResult, invokeCliPlanner } from "../cli-planner-provider";
import {
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
} from "../planner-provider";
import { CodexCliRunner, DefaultCodexCliRunner, normalizeUsageFromCodex } from "./client";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CodexCliPlannerProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  runner?: CodexCliRunner;
  env?: Record<string, string | undefined>;
}

export class CodexCliPlannerProvider implements PlannerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CodexCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CodexCliPlannerProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CODEX_BINARY ?? "codex";
    if (options.cwd !== undefined) this.cwd = options.cwd;
    this.model = options.model;
    this.name = `codex-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
    this.runner = options.runner ?? new DefaultCodexCliRunner();
    this.env = options.env ?? process.env;
  }

  async plan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    return this.invoke(input, "initial");
  }

  async repair(input: PlannerProviderInput, context: PlannerProviderRepairContext): Promise<PlannerProviderOutput> {
    return this.invoke(input, "repair", context);
  }

  private async invoke(
    input: PlannerProviderInput,
    attemptType: "initial" | "repair",
    context?: PlannerProviderRepairContext,
  ): Promise<PlannerProviderOutput> {
    return invokeCliPlanner({
      providerName: this.name,
      label: "codex-cli",
      accessMode: AccessModes.CodexCli,
      binary: this.binary,
      model: this.model,
      input,
      attemptType,
      ...(context ? { context } : {}),
      env: this.env,
      timeoutMs: this.timeoutMs,
      normalizeUsage: normalizeUsageFromCodex,
      run: (prompt, env): Promise<CliPlannerResult> =>
        this.runner.run({
          binary: this.binary,
          cwd: this.cwd ?? input.initiative.repoPath,
          ...(this.model ? { model: this.model } : {}),
          sandbox: "read-only",
          prompt,
          timeoutMs: this.timeoutMs,
          env,
        }),
    });
  }
}
