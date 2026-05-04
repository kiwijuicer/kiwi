import { PlannerProviderInput } from "../../../planner-provider";

export function buildPlannerUserEnvelope(input: PlannerProviderInput): string {
  return JSON.stringify(
    {
      request: "Create a kiwi TaskGraph.",
      runId: input.runId,
      requestedAt: input.requestedAt,
      initiative: input.initiative,
      policy: input.policy,
    },
    null,
    2,
  );
}

export function buildPlannerRepairEnvelope(params: {
  input: PlannerProviderInput;
  invalidAttempt: number;
  invalidOutput: unknown;
  validationError: string;
}): string {
  return JSON.stringify(
    {
      request: "Repair the previous TaskGraph so it validates against TaskGraphSchema.",
      runId: params.input.runId,
      requestedAt: params.input.requestedAt,
      initiativeId: params.input.initiative.id,
      invalidAttempt: params.invalidAttempt,
      validationError: params.validationError,
      invalidOutput: params.invalidOutput,
      constraints: [
        "Return only the corrected TaskGraph via the required tool.",
        "Preserve valid intent from the original output.",
        "Do not add unrelated steps.",
      ],
    },
    null,
    2,
  );
}
