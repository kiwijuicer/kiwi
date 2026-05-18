import { AccessModes } from "@kiwi/contracts";
import { CliPlannerResult } from "../../providers/cli-planner";
import { invokeCliResearcher } from "../../providers/cli-researcher";
import { ResearcherProvider, ResearcherProviderInput, ResearcherProviderOutput } from "../../providers/researcher";
import { CursorAgentCliRunner, DefaultCursorAgentCliRunner, normalizeUsageFromCursorAgent } from "./client";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CursorAgentResearcherProviderOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  runner?: CursorAgentCliRunner;
  env?: Record<string, string | undefined>;
}

export class CursorAgentResearcherProvider implements ResearcherProvider {
  readonly name: string;
  private readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly runner: CursorAgentCliRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: CursorAgentResearcherProviderOptions = {}) {
    this.binary = options.binary ?? process.env.KIWI_CURSOR_AGENT_BINARY ?? "cursor-agent";
    if (options.cwd !== undefined) {
      this.cwd = options.cwd;
    }
    this.model = options.model;
    this.name = `cursor-agent-cli:${this.model ?? "default"}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? new DefaultCursorAgentCliRunner();
    this.env = options.env ?? process.env;
  }

  async research(input: ResearcherProviderInput): Promise<ResearcherProviderOutput> {
    return invokeCliResearcher({
      providerName: this.name,
      label: "cursor-agent-cli",
      accessMode: AccessModes.CursorAgentCli,
      binary: this.binary,
      model: this.model,
      input,
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
