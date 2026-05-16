import { RunExecutionPreviewBuilder } from "./planned-step-execution/preview-builder";
import { PlannedStepExecutionService } from "./planned-step-execution/service";
import type {
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  RunExecutionPreview,
} from "./planned-step-execution/types";

export type {
  AttemptDiffMaterialization,
  ExecutePlannedStepInput,
  ExecutePlannedStepResult,
  RunExecutionPreview,
  RunExecutionPreviewStep,
} from "./planned-step-execution/types";

export function buildRunExecutionPreview(params: {
  cwd: string;
  runId: string;
  fromStep?: string;
  maxConcurrency?: number;
  now?: Date;
}): RunExecutionPreview {
  return new RunExecutionPreviewBuilder().build(params);
}

export async function executePlannedStep(input: ExecutePlannedStepInput): Promise<ExecutePlannedStepResult> {
  return new PlannedStepExecutionService().execute(input);
}
