import { KiwiRunnerEnvVars } from "@kiwi/contracts";

const BASE_RUNNER_ENV = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "CI"] as const;

interface RunnerEnvPolicy {
  envAllowlist?: string[];
}

function stringEntries(env: Record<string, string | undefined>): Record<string, string> {
  const selected: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      selected[key] = value;
    }
  }

  return selected;
}

export function buildRunnerEnv(params: {
  sourceEnv?: Record<string, string | undefined> | undefined;
  inputEnv?: Record<string, string | undefined> | undefined;
  policy?: RunnerEnvPolicy | undefined;
  extraAllowlist?: string[] | undefined;
}): Record<string, string> {
  const source = stringEntries(params.sourceEnv ?? process.env);
  const input = stringEntries(params.inputEnv ?? {});
  const allowlist = new Set<string>([
    ...BASE_RUNNER_ENV,
    ...(params.policy?.envAllowlist ?? []),
    ...(params.extraAllowlist ?? []),
  ]);
  const selected: Record<string, string> = {};

  for (const key of allowlist) {
    const value = input[key] ?? source[key];

    if (value !== undefined) {
      selected[key] = value;
    }
  }

  selected[KiwiRunnerEnvVars.Active] = "1";

  return selected;
}
