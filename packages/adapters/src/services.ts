import type { KiwiPolicy } from "@kiwi/contracts";
import { runnerTimeoutMs, cliRunnerOutput } from "./runners/cli-output.js";
import { redactForProvider, secretEnvNamesFromPolicy } from "./providers/redaction.js";
import { buildRepoContextEnvelope, renderRepoContext } from "./providers/repo-context.js";
import { runSubprocess } from "./runners/subprocess.js";

export class ProviderRedactionService {
  constructor(
    private readonly deps: {
      secretEnvNamesFromPolicy: typeof secretEnvNamesFromPolicy;
      redactForProvider: typeof redactForProvider;
    } = {
      secretEnvNamesFromPolicy,
      redactForProvider,
    },
  ) {}

  secretEnvNamesFromPolicy(policy: KiwiPolicy): string[] {
    return this.deps.secretEnvNamesFromPolicy(policy);
  }

  redactForProvider<T>(
    value: T,
    policy: KiwiPolicy,
    env: Record<string, string | undefined>,
  ): ReturnType<typeof redactForProvider<T>> {
    return this.deps.redactForProvider(value, policy, env);
  }
}

export class RepoContextService {
  constructor(
    private readonly deps: {
      buildRepoContextEnvelope: typeof buildRepoContextEnvelope;
      renderRepoContext: typeof renderRepoContext;
    } = {
      buildRepoContextEnvelope,
      renderRepoContext,
    },
  ) {}

  buildEnvelope(params: Parameters<typeof buildRepoContextEnvelope>[0]): ReturnType<typeof buildRepoContextEnvelope> {
    return this.deps.buildRepoContextEnvelope(params);
  }

  render(context: Parameters<typeof renderRepoContext>[0]): string {
    return this.deps.renderRepoContext(context);
  }
}

export class RunnerOutputService {
  constructor(
    private readonly deps: {
      runnerTimeoutMs: typeof runnerTimeoutMs;
      cliRunnerOutput: typeof cliRunnerOutput;
    } = {
      runnerTimeoutMs,
      cliRunnerOutput,
    },
  ) {}

  timeoutMs(input: Parameters<typeof runnerTimeoutMs>[0], adapterTimeoutMs: number): number {
    return this.deps.runnerTimeoutMs(input, adapterTimeoutMs);
  }

  output(params: Parameters<typeof cliRunnerOutput>[0]): ReturnType<typeof cliRunnerOutput> {
    return this.deps.cliRunnerOutput(params);
  }
}

export class SubprocessService {
  constructor(
    private readonly deps: {
      runSubprocess: typeof runSubprocess;
    } = {
      runSubprocess,
    },
  ) {}

  run(invocation: Parameters<typeof runSubprocess>[0]): ReturnType<typeof runSubprocess> {
    return this.deps.runSubprocess(invocation);
  }
}

export interface AdapterServices {
  redaction: ProviderRedactionService;
  repoContext: RepoContextService;
  runnerOutput: RunnerOutputService;
  subprocesses: SubprocessService;
}

export function createAdapterServices(): AdapterServices {
  return {
    redaction: new ProviderRedactionService(),
    repoContext: new RepoContextService(),
    runnerOutput: new RunnerOutputService(),
    subprocesses: new SubprocessService(),
  };
}
