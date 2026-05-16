import { ExecutionAuditReporter } from "./audit";
import { ExecutionContextLoader } from "./context";
import { AttemptDiffMaterializer } from "./diff-materializer";
import { StepAttemptExecutor } from "./executor";
import { ExecutionPolicyResolver } from "./policy";
import { RunExecutionPreviewBuilder } from "./preview-builder";
import { StepRunnerSelector } from "./runner-selection";
import { SchedulerDecisionService } from "./scheduler";
import { PlannedStepExecutionService } from "./service";
import { ExecutionTargetResolver } from "./target";

export interface RuntimeExecutionServices {
  plannedSteps: PlannedStepExecutionService;
  previews: RunExecutionPreviewBuilder;
}

export function createRuntimeExecutionServices(): RuntimeExecutionServices {
  const contextLoader = new ExecutionContextLoader();
  const policyResolver = new ExecutionPolicyResolver();
  const auditReporter = new ExecutionAuditReporter();
  const runnerSelector = new StepRunnerSelector(policyResolver, auditReporter);
  const schedulerDecisionService = new SchedulerDecisionService(policyResolver);
  const targetResolver = new ExecutionTargetResolver();
  const diffMaterializer = new AttemptDiffMaterializer();
  const attemptExecutor = new StepAttemptExecutor(policyResolver, diffMaterializer);

  return {
    plannedSteps: new PlannedStepExecutionService(
      contextLoader,
      policyResolver,
      runnerSelector,
      schedulerDecisionService,
      targetResolver,
      attemptExecutor,
    ),
    previews: new RunExecutionPreviewBuilder(contextLoader, policyResolver, runnerSelector, schedulerDecisionService),
  };
}
