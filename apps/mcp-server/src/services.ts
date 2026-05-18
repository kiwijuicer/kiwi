import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createRuntimeServices, type RuntimeServices } from "@kiwi/runtime";

interface McpServerServices {
  core: CoreServices;
  runtime: RuntimeServices;
}

export function createMcpServerServices(): McpServerServices {
  const core = createCoreServices();

  return {
    core,
    runtime: createRuntimeServices({ core }),
  };
}

const mcpServerServices = createMcpServerServices();

export function getMcpServerServices(): McpServerServices {
  return mcpServerServices;
}
