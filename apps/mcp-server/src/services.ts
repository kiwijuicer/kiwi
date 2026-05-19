import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createRuntimeServices, type RuntimeServices } from "@kiwi/runtime";

interface McpServerServices {
  core: CoreServices;
  runtime: RuntimeServices;
}

function createMcpServerServices(): McpServerServices {
  const core = createCoreServices();
  const env = {
    ...process.env,
    KIWI_EXECUTION_ISOLATION: process.env.KIWI_EXECUTION_ISOLATION ?? "direct",
  };

  return {
    core,
    runtime: createRuntimeServices({ core, env }),
  };
}

let mcpServerServices: McpServerServices | null = null;

export function getMcpServerServices(): McpServerServices {
  if (!mcpServerServices) {
    mcpServerServices = createMcpServerServices();
  }

  return mcpServerServices;
}

export function resetMcpServerServicesForTests(): void {
  mcpServerServices = null;
}
