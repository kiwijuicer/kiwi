import { createRuntimeExecutionServices } from "./planned-step-execution/factory";
import type {
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  RunExecutionPreview,
} from "./planned-step-execution/types";

export {
  createRuntimeExecutionServices,
  type RuntimeExecutionServiceDependencies,
  type RuntimeExecutionServices,
} from "./planned-step-execution/factory";
export {
  AttemptDiffStatuses,
  DEFAULT_MAX_CONCURRENCY,
  ExecutionToolNames,
  ExecutorSelectionReasons,
} from "./planned-step-execution/types";
export type {
  AttemptDiffMaterialization,
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  RunExecutionPreview,
  RunExecutionPreviewStep,
} from "./planned-step-execution/types";

const runtimeExecutionServices = createRuntimeExecutionServices();

export function buildRunExecutionPreview(params: {
  cwd: string;
  runId: string;
  fromStep?: string;
  maxConcurrency?: number;
  now?: Date;
}): RunExecutionPreview {
  return runtimeExecutionServices.previews.build(params);
}

export async function executePlannedStep(input: ExecutePlannedStepInput): Promise<ExecutePlannedStepResult> {
  return runtimeExecutionServices.plannedSteps.execute(input);
}
