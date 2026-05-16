import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createRuntimeServices, type RuntimeServices } from "@kiwi/runtime";

interface CliServices {
  core: CoreServices;
  runtime: RuntimeServices;
}

export function createCliServices(): CliServices {
  const core = createCoreServices();

  return {
    core,
    runtime: createRuntimeServices({ core }),
  };
}
