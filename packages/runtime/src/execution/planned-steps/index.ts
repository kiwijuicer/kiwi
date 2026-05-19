import { createRuntimeExecutionServices } from "./factory";
import type { ExecutePlannedStepInput, ExecutePlannedStepResult, RunExecutionPreview } from "./types";

export {
  createRuntimeExecutionServices,
  type RuntimeExecutionServiceDependencies,
  type RuntimeExecutionServices,
} from "./factory";
export {
  AttemptDiffStatuses,
  DEFAULT_MAX_CONCURRENCY,
  ExecutionToolNames,
  ExecutorSelectionReasons,
} from "./types";
export {
  CONTEXT_RETRIEVAL_STRATEGY_VERSION,
  ExecutionContextRetriever,
  type ExecutionContextRetrieval,
  type RetrievedContextFile,
} from "./context-retriever";
export type {
  AttemptDiffMaterialization,
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  RunExecutionPreview,
  RunExecutionPreviewStep,
} from "./types";

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
