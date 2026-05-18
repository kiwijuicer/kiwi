import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createRuntimeServices, type RuntimeServices } from "@kiwi/runtime";

interface McpServerServices {
  core: CoreServices;
  runtime: RuntimeServices;
}

function createMcpServerServices(): McpServerServices {
  const core = createCoreServices();

  return {
    core,
    runtime: createRuntimeServices({ core }),
  };
}

let mcpServerServices: McpServerServices | null = null;

export function getMcpServerServices(): McpServerServices {
  if (!mcpServerServices) {
    mcpServerServices = createMcpServerServices();
  }

  return mcpServerServices;
}
