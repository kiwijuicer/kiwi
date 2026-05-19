import { MutationRequirements, StepType, StepTypes, type MutationRequirement } from "@kiwi/contracts";

const MUST_CHANGE_STEP_TYPES = new Set<StepType>([
  StepTypes.Coding,
  StepTypes.CodeCreation,
  StepTypes.CodeModification,
  StepTypes.Refactoring,
  StepTypes.TestCreation,
  StepTypes.Documentation,
  StepTypes.RulesUpdate,
]);

const NO_FILE_CHANGE_STEP_TYPES = new Set<StepType>([
  StepTypes.Validation,
  StepTypes.Review,
  StepTypes.ScmTicket,
  StepTypes.ScmPullRequest,
  StepTypes.ScmReview,
]);

export function mutationRequirementForStepType(stepType: StepType): MutationRequirement {
  if (MUST_CHANGE_STEP_TYPES.has(stepType)) {
    return MutationRequirements.MustChangeFiles;
  }
  if (NO_FILE_CHANGE_STEP_TYPES.has(stepType)) {
    return MutationRequirements.NoFileChanges;
  }

  return MutationRequirements.MayChangeFiles;
}
