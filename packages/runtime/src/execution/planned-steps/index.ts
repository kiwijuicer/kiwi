import { createRuntimeExecutionServices } from "./factory.js";
import type { ExecutePlannedStepInput, ExecutePlannedStepResult, RunExecutionPreview } from "./types.js";

export {
  createRuntimeExecutionServices,
  type RuntimeExecutionServiceDependencies,
  type RuntimeExecutionServices,
} from "./factory.js";
export {
  AttemptDiffStatuses,
  DEFAULT_MAX_CONCURRENCY,
  ExecutionToolNames,
  ExecutorSelectionReasons,
} from "./types.js";
export {
  CONTEXT_RETRIEVAL_STRATEGY_VERSION,
  ExecutionContextRetriever,
  type ExecutionContextRetrieval,
  type RetrievedContextFile,
} from "./context-retriever.js";
export type {
  AttemptDiffMaterialization,
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  RunExecutionPreview,
  RunExecutionPreviewStep,
} from "./types.js";

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
