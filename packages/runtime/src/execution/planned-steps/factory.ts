import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createSandboxServices, type SandboxServices, type SandboxCommandPolicy } from "@kiwi/sandbox";
import { OperatorPolicyService } from "../../policies/operator-policy.js";
import { ResearcherProviderRegistry } from "../../registries/researcher-provider-registry.js";
import { RunnerResolver } from "../../registries/runner-resolution.js";
import { SchedulerPolicyService } from "../../policies/scheduler-policy.js";
import { StepAttemptOrchestrator } from "../step-attempt-orchestrator.js";
import { ExecutionAuditReporter } from "./audit.js";
import { ExecutionContextLoader } from "./context.js";
import { AttemptDiffMaterializer } from "./diff-materializer.js";
import { RequiredGateRunner, ReviewEngineFactory, StepAttemptExecutor } from "./executor.js";
import { ExecutionPolicyResolver } from "./policy.js";
import { RunExecutionPreviewBuilder } from "./preview-builder.js";
import { StepRunnerSelector } from "./runner-selection.js";
import { SchedulerDecisionService } from "./scheduler.js";
import { PlannedStepExecutionService } from "./service.js";
import { ExecutionTargetResolver } from "./target.js";

export interface RuntimeExecutionServices {
  plannedSteps: PlannedStepExecutionService;
  previews: RunExecutionPreviewBuilder;
}

export interface RuntimeExecutionServiceDependencies {
  core?: CoreServices;
  sandbox?: SandboxServices;
  env?: Record<string, string | undefined>;
}

export function createRuntimeExecutionServices(
  dependencies: RuntimeExecutionServiceDependencies = {},
): RuntimeExecutionServices {
  const core = dependencies.core ?? createCoreServices();
  const sandbox = dependencies.sandbox ?? createSandboxServices();
  const contextLoader = new ExecutionContextLoader(core, dependencies.env);
  const policyResolver = new ExecutionPolicyResolver(dependencies.env);
  const schedulerPolicy = new SchedulerPolicyService();
  const operatorPolicy = new OperatorPolicyService();
  const auditReporter = new ExecutionAuditReporter();
  const runnerSelector = new StepRunnerSelector(
    policyResolver,
    auditReporter,
    new RunnerResolver(),
    new ResearcherProviderRegistry(),
  );
  const schedulerDecisionService = new SchedulerDecisionService(policyResolver, schedulerPolicy, core);
  const targetResolver = new ExecutionTargetResolver(sandbox, core);
  const diffMaterializer = new AttemptDiffMaterializer(core);
  const attemptExecutor = new StepAttemptExecutor(
    policyResolver,
    diffMaterializer,
    core,
    operatorPolicy,
    new StepAttemptOrchestrator<SandboxCommandPolicy>(),
    new ReviewEngineFactory(),
    new RequiredGateRunner(),
  );

  return {
    plannedSteps: new PlannedStepExecutionService(
      contextLoader,
      policyResolver,
      core,
      runnerSelector,
      schedulerDecisionService,
      targetResolver,
      attemptExecutor,
    ),
    previews: new RunExecutionPreviewBuilder(
      contextLoader,
      policyResolver,
      core,
      runnerSelector,
      schedulerDecisionService,
    ),
  };
}
