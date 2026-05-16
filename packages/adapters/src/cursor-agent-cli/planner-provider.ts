import { AccessModes } from "@kiwi/contracts";
import type { ProviderAttemptType } from "../constants";
import { CliPlannerResult, invokeCliPlanner } from "../cli-planner-provider";
import {
  PlannerProvider,
  PlannerProviderInput,
  PlannerProviderOutput,
  PlannerProviderRepairContext,
} from "../planner-provider";
import { CursorAgentCliRunner, DefaultCursorAgentCliRunner, normalizeUsageFromCursorAgent } from "./client";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CursorAgentPlannerProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  maxRepairAttempts?: number;
  runner?: CursorAgentCliRunner;
  env?: Record<string, string | undefined>;
}

export class CursorAgentPlannerProvider implements PlannerProvider {
  readonly name: string;
  readonly maxRepairAttempts: number;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CursorAgentCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CursorAgentPlannerProviderOptions = {}) {
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
  }

  async plan(input: PlannerProviderInput): Promise<PlannerProviderOutput> {
    return this.invoke(input, "initial");
  }

  async repair(input: PlannerProviderInput, context: PlannerProviderRepairContext): Promise<PlannerProviderOutput> {
    return this.invoke(input, "repair", context);
  }

  private async invoke(
    input: PlannerProviderInput,
    attemptType: ProviderAttemptType,
    context?: PlannerProviderRepairContext,
  ): Promise<PlannerProviderOutput> {
    return invokeCliPlanner({
      providerName: this.name,
      label: "cursor-agent-cli",
      accessMode: AccessModes.CursorAgentCli,
      binary: this.binary,
      model: this.model,
      input,
      attemptType,
      ...(context ? { context } : {}),
      env: this.env,
      timeoutMs: this.timeoutMs,
      normalizeUsage: normalizeUsageFromCursorAgent,
      run: (prompt, env): Promise<CliPlannerResult> =>
        this.runner.run({
          binary: this.binary,
          cwd: this.cwd ?? input.initiative.repoPath,
          ...(this.model ? { model: this.model } : {}),
          prompt,
          outputFormat: "json",
          timeoutMs: this.timeoutMs,
          env,
        }),
    });
  }
}
