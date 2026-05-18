import { createCoreServices, type CoreServices } from "@kiwi/core";
import { createSandboxServices, type SandboxServices, type SandboxCommandPolicy } from "@kiwi/sandbox";
import { OperatorPolicyService } from "../../policies/operator-policy";
import { ResearcherProviderRegistry } from "../../registries/researcher-provider-registry";
import { RunnerResolver } from "../../registries/runner-resolution";
import { SchedulerPolicyService } from "../../policies/scheduler-policy";
import { StepAttemptOrchestrator } from "../step-attempt-orchestrator";
import { ExecutionAuditReporter } from "./audit";
import { ExecutionContextLoader } from "./context";
import { AttemptDiffMaterializer } from "./diff-materializer";
import { RequiredGateRunner, ReviewEngineFactory, StepAttemptExecutor } from "./executor";
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
  const targetResolver = new ExecutionTargetResolver(sandbox);
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
