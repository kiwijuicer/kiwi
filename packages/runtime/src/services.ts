import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createSandboxServices, type SandboxServices } from "@kiwi/sandbox";
import { createRuntimeExecutionServices, type RuntimeExecutionServices } from "./execution/planned-steps/factory";

export interface RuntimeServices {
  core: CoreServices;
  sandbox: SandboxServices;
  execution: RuntimeExecutionServices;
}

export interface RuntimeServiceDependencies {
  core?: CoreServices;
  sandbox?: SandboxServices;
  env?: Record<string, string | undefined>;
}

export function createRuntimeServices(dependencies: RuntimeServiceDependencies = {}): RuntimeServices {
  const core = dependencies.core ?? createCoreServices();
  const sandbox = dependencies.sandbox ?? createSandboxServices();
  const executionDependencies: Parameters<typeof createRuntimeExecutionServices>[0] = { core, sandbox };

  if (dependencies.env) {
    executionDependencies.env = dependencies.env;
  }

  return {
    core,
    sandbox,
    execution: createRuntimeExecutionServices(executionDependencies),
  };
}
