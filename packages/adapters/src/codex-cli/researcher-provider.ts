import { AccessModes } from "@kiwi/contracts";
import { CliPlannerResult } from "../cli-planner-provider";
import { invokeCliResearcher } from "../cli-researcher-provider";
import { ResearcherProvider, ResearcherProviderInput, ResearcherProviderOutput } from "../researcher-provider";
import { CodexCliRunner, DefaultCodexCliRunner, normalizeUsageFromCodex } from "./client";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CodexCliResearcherProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  runner?: CodexCliRunner;
  env?: Record<string, string | undefined>;
}

export class CodexCliResearcherProvider implements ResearcherProvider {
  readonly name: string;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CodexCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CodexCliResearcherProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CODEX_BINARY ?? "codex";
    if (options.cwd !== undefined) this.cwd = options.cwd;
    this.model = options.model;
    this.name = `codex-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? new DefaultCodexCliRunner();
    this.env = options.env ?? process.env;
  }

  async research(input: ResearcherProviderInput): Promise<ResearcherProviderOutput> {
    return invokeCliResearcher({
      providerName: this.name,
      label: "codex-cli",
      accessMode: AccessModes.CodexCli,
      binary: this.binary,
      model: this.model,
      input,
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
