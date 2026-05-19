import chalk from "chalk";
import { ACCESS_MODE_VALUES, AccessMode, ContractValues, ModelEntry, Step } from "@kiwi/contracts";
import { isInitialized, loadEffectivePolicy, loadEffectiveRegistry } from "@kiwi/core";
import { evaluateAccessModeAvailability, preferredAccessModes, RunnerRegistry } from "@kiwi/runtime";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../../workspace/options";

type DoctorOptions = CliWorkspaceOptions;

const DOCTOR_RUNNER_STEP: Step = {
  stepId: "doctor_runner_probe",
  type: "coding",
  title: "Probe runner availability",
  dependsOn: [],
  successCriteria: [],
  requiredGates: [],
  recommendedAgentRole: ContractValues.Executor,
  recommendedModelCapability: ContractValues.Strong,
  status: ContractValues.Pending,
};

function printRegistryAccessModes(enabled: ModelEntry[], env: NodeJS.ProcessEnv): void {
  const enabledByMode = new Map<AccessMode, number>();

  for (const entry of enabled) {
    enabledByMode.set(entry.accessMode, (enabledByMode.get(entry.accessMode) ?? 0) + 1);
  }
  for (const accessMode of ACCESS_MODE_VALUES) {
    const count = enabledByMode.get(accessMode) ?? 0;

    if (count === 0) {
      continue;
    }
    const availability = evaluateAccessModeAvailability(accessMode, env);
    const status = availability.available ? chalk.green("available") : chalk.yellow("unavailable");
    const reasonText = accessMode === "stub" ? "test-only; requires KIWI_TEST_ALLOW_STUB=1" : availability.reason;
    const reason = reasonText ? chalk.dim(` (${reasonText})`) : "";
    console.log(`  ${chalk.cyan(accessMode)}: ${count} entries — ${status}${reason}`);
  }
}

function printRunnerRegistry(registryModels: ModelEntry[], env: NodeJS.ProcessEnv): void {
  const runnerResolution = new RunnerRegistry().resolve({
    registryModels,
    step: DOCTOR_RUNNER_STEP,
    env,
  });
  const runners = runnerResolution.runnerAvailabilityDetails
    .map((entry) => {
      const status = entry.available ? "ok" : "unavailable";

      return entry.reason ? `${entry.runner}:${status} (${entry.reason})` : `${entry.runner}:${status}`;
    })
    .join(", ");
  console.log(`runner registry: ${runners}`);
}

function printRoleCounts(enabled: ModelEntry[]): void {
  const planners = enabled.filter((entry) => entry.roles.includes(ContractValues.Planner));
  const researchers = enabled.filter((entry) => entry.roles.includes(ContractValues.Researcher));
  const reviewers = enabled.filter((entry) => entry.roles.includes(ContractValues.Reviewer));
  const executors = enabled.filter((entry) => entry.roles.includes(ContractValues.Executor));
  console.log(
    `roles enabled: planner=${planners.length}, researcher=${researchers.length}, reviewer=${reviewers.length}, executor=${executors.length}`,
  );
}

function printDeprecatedModels(models: ModelEntry[]): void {
  const deprecated = models.filter((entry) => entry.deprecatedAt);

  if (deprecated.length === 0) {
    return;
  }
  console.log(chalk.yellow(`deprecated models: ${deprecated.length}`));
  for (const model of deprecated) {
    const replacement = model.replacementModelId ? ` -> ${model.replacementModelId}` : "";
    console.log(`  ${model.id}${replacement}`);
  }
}

function printInitializedWorkspaceDiagnostics(workspacePath: string, env: NodeJS.ProcessEnv): void {
  const policy = loadEffectivePolicy(workspacePath, { env });
  const registry = loadEffectiveRegistry(workspacePath, { env });
  console.log(`policy: ${chalk.green(policy.project.name)} (${policy.routing.defaultModelCapability} default)`);
  console.log(
    `registry: ${chalk.green(registry.models.length)} entries${registry.catalogVersion ? chalk.dim(` (catalog ${registry.catalogVersion})`) : ""}`,
  );

  const enabled = registry.models.filter((entry) => entry.enabled);
  printRegistryAccessModes(enabled, env);

  const order = preferredAccessModes(env);
  console.log(`preferred order: ${order.join(" > ")}`);
  printRunnerRegistry(registry.models, env);
  printRoleCounts(enabled);
  printDeprecatedModels(registry.models);
}

function printAccessModeProbes(env: NodeJS.ProcessEnv): void {
  const probes: Array<{ mode: AccessMode; label: string; role: string }> = [
    { mode: "claude-code-cli", label: "claude", role: "local CLI auth: runner/planner/researcher/reviewer" },
    { mode: "codex-cli", label: "codex", role: "local CLI auth: runner/planner/researcher/reviewer" },
    { mode: "cursor-agent-cli", label: "cursor-agent", role: "local CLI auth: runner/planner/researcher/reviewer" },
    { mode: "cursor", label: "cursor", role: "IDE surface" },
    { mode: "jetbrains", label: "phpstorm", role: "IDE surface" },
    { mode: "anthropic-api", label: "ANTHROPIC_API_KEY", role: "not required for daily use" },
    { mode: "openai-api", label: "OPENAI_API_KEY", role: "not required for daily use" },
    { mode: "stub", label: "stub", role: "test-only; requires KIWI_TEST_ALLOW_STUB=1" },
  ];
  console.log(chalk.bold("\naccess modes:"));
  for (const probe of probes) {
    const mode = probe.mode;
    const availability = evaluateAccessModeAvailability(mode, env);
    const status = availability.available ? chalk.green("ok") : chalk.dim("not configured");
    const reason = availability.reason ? ` ${chalk.dim(availability.reason)}` : "";
    console.log(`  ${probe.label.padEnd(20)} ${status} ${chalk.dim(probe.role)}${reason}`);
  }
  console.log(chalk.dim("  direct API keys      optional only; default daily use relies on local CLI logins"));
}

export async function runDoctor(opts: DoctorOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const env = process.env;
  console.log(chalk.bold("kiwi doctor"));
  console.log(chalk.dim(`cwd: ${cwd}`));

  const workspace = resolveCliWorkspace(opts, cwd, false);
  const workspacePath = workspace.workspacePath;
  console.log(chalk.dim(`workspace: ${workspacePath}`));

  if (!isInitialized(workspacePath)) {
    console.log(chalk.yellow(`! workspace not initialized — run 'kiwi init'`));
  } else {
    printInitializedWorkspaceDiagnostics(workspacePath, env);
  }

  printAccessModeProbes(env);
}
