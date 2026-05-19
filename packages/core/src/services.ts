import type {
  BudgetProfile,
  ContextLevel,
  KiwiConfig,
  ModelCapability,
  ModelEntry,
  ModelInvocationRecord,
  RunStatus,
} from "@kiwi/contracts";
import {
  assertWithinBudgetEstimate,
  budgetLimitForProfile,
  budgetSoftCapExceeded,
  estimateAttemptCostUsd,
  remainingBudgetAfterEstimatedCost,
  remainingBudgetUsdEstimate,
} from "./budget/policy";
import {
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  loadKiwiConfig,
  loadPolicy,
  loadRegistry,
  saveKiwiConfig,
} from "./config";
import { appendAuditEvent, readAuditEvents } from "./ledger/cost-ledger";
import {
  assertStepDependenciesCompleted,
  latestAttemptByStep,
  listStepAttemptEvidence,
  type StepAttemptEvidence,
} from "./runs/lifecycle/evidence-collection";
import {
  loadApprovalDecision,
  loadLatestApprovalDecisionForStep,
  recordApprovalDecision,
} from "./runs/lifecycle/approval";
import { refreshRunStatusFromAttempts, updateRunPlanStatus, updateRunStatus } from "./runs/lifecycle/status";
import {
  appendModelInvocation,
  buildFinalCostReportFromModelInvocations,
  inferAccessMode,
  readModelInvocations,
  summarizeModelInvocations,
  writeModelUsageSummary,
} from "./ledger/model-invocations";
import { acquireRunLock, withRunLock, type RunLock } from "./runs/lock";
import {
  ensureRunLayout,
  isInitialized,
  listRunIds,
  listRunManifests,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
  resolveRunArtifactPath,
  savePlannedRun,
} from "./runs/store";
import { listRunFeedback, recordRunFeedback } from "./runs/feedback";
import { getRunStatusSummary, resolveActiveRun } from "./runs/status";
import { discoverWorkspaceRepos, resolveWorkspace } from "./workspace";

export class RunArtifactStore {
  constructor(
    private readonly deps: {
      resolveRunArtifactPath: typeof resolveRunArtifactPath;
      ensureRunLayout: typeof ensureRunLayout;
    } = {
      resolveRunArtifactPath,
      ensureRunLayout,
    },
  ) {}

  resolvePath(runId: string, artifactRelativePath: string, cwd: string): string {
    return this.deps.resolveRunArtifactPath(runId, artifactRelativePath, cwd);
  }

  ensureLayout(runId: string, cwd: string): ReturnType<typeof ensureRunLayout> {
    return this.deps.ensureRunLayout(runId, cwd);
  }
}

export class KiwiConfigRepository {
  constructor(
    private readonly deps: {
      kiwiPolicyPath: typeof kiwiPolicyPath;
      kiwiModelRegistryPath: typeof kiwiModelRegistryPath;
      loadEffectivePolicy: typeof loadEffectivePolicy;
      loadEffectiveRegistry: typeof loadEffectiveRegistry;
      loadPolicy: typeof loadPolicy;
      loadRegistry: typeof loadRegistry;
      loadKiwiConfig: typeof loadKiwiConfig;
      saveKiwiConfig: typeof saveKiwiConfig;
    } = {
      kiwiPolicyPath,
      kiwiModelRegistryPath,
      loadEffectivePolicy,
      loadEffectiveRegistry,
      loadPolicy,
      loadRegistry,
      loadKiwiConfig,
      saveKiwiConfig,
    },
  ) {}

  policyPath(cwd: string): string {
    return this.deps.kiwiPolicyPath(cwd);
  }

  modelRegistryPath(cwd: string): string {
    return this.deps.kiwiModelRegistryPath(cwd);
  }

  loadEffectivePolicy(
    workspacePath: string,
    opts?: Parameters<typeof loadEffectivePolicy>[1],
  ): ReturnType<typeof loadEffectivePolicy> {
    return this.deps.loadEffectivePolicy(workspacePath, opts);
  }

  loadEffectiveRegistry(
    workspacePath: string,
    opts?: Parameters<typeof loadEffectiveRegistry>[1],
  ): ReturnType<typeof loadEffectiveRegistry> {
    return this.deps.loadEffectiveRegistry(workspacePath, opts);
  }

  loadPolicy(path: string): ReturnType<typeof loadPolicy> {
    return this.deps.loadPolicy(path);
  }

  loadRegistry(path: string): ReturnType<typeof loadRegistry> {
    return this.deps.loadRegistry(path);
  }

  loadConfig(configPath: string): ReturnType<typeof loadKiwiConfig> {
    return this.deps.loadKiwiConfig(configPath);
  }

  saveConfig(configPath: string, config: KiwiConfig): KiwiConfig {
    return this.deps.saveKiwiConfig(configPath, config);
  }
}

export class RunStore {
  constructor(
    private readonly deps: {
      isInitialized: typeof isInitialized;
      savePlannedRun: typeof savePlannedRun;
      loadInitiative: typeof loadInitiative;
      loadRunManifest: typeof loadRunManifest;
      loadTaskGraph: typeof loadTaskGraph;
      listRunManifests: typeof listRunManifests;
      listRunIds: typeof listRunIds;
    } = {
      isInitialized,
      savePlannedRun,
      loadInitiative,
      loadRunManifest,
      loadTaskGraph,
      listRunManifests,
      listRunIds,
    },
  ) {}

  isInitialized(cwd: string): boolean {
    return this.deps.isInitialized(cwd);
  }

  savePlannedRun(params: Parameters<typeof savePlannedRun>[0]): ReturnType<typeof savePlannedRun> {
    return this.deps.savePlannedRun(params);
  }

  loadInitiative(runId: string, cwd: string): ReturnType<typeof loadInitiative> {
    return this.deps.loadInitiative(runId, cwd);
  }

  loadManifest(runId: string, cwd: string): ReturnType<typeof loadRunManifest> {
    return this.deps.loadRunManifest(runId, cwd);
  }

  loadTaskGraph(runId: string, cwd: string): ReturnType<typeof loadTaskGraph> {
    return this.deps.loadTaskGraph(runId, cwd);
  }

  listManifests(cwd: string): ReturnType<typeof listRunManifests> {
    return this.deps.listRunManifests(cwd);
  }

  listIds(cwd: string): string[] {
    return this.deps.listRunIds(cwd);
  }
}

export class RunStatusReader {
  constructor(
    private readonly deps: {
      updateRunStatus: typeof updateRunStatus;
      updateRunPlanStatus: typeof updateRunPlanStatus;
      refreshRunStatusFromAttempts: typeof refreshRunStatusFromAttempts;
      getRunStatusSummary: typeof getRunStatusSummary;
      resolveActiveRun: typeof resolveActiveRun;
    } = {
      updateRunStatus,
      updateRunPlanStatus,
      refreshRunStatusFromAttempts,
      getRunStatusSummary,
      resolveActiveRun,
    },
  ) {}

  update(params: { cwd: string; runId: string; status: RunStatus; now?: Date }): ReturnType<typeof updateRunStatus> {
    return this.deps.updateRunStatus(params);
  }

  updatePlan(params: Parameters<typeof updateRunPlanStatus>[0]): ReturnType<typeof updateRunPlanStatus> {
    return this.deps.updateRunPlanStatus(params);
  }

  refreshFromAttempts(params: {
    cwd: string;
    runId: string;
    now?: Date;
  }): ReturnType<typeof refreshRunStatusFromAttempts> {
    return this.deps.refreshRunStatusFromAttempts(params);
  }

  summary(cwd: string, runId?: string): ReturnType<typeof getRunStatusSummary> {
    return this.deps.getRunStatusSummary(cwd, runId);
  }

  active(input: Parameters<typeof resolveActiveRun>[0]): ReturnType<typeof resolveActiveRun> {
    return this.deps.resolveActiveRun(input);
  }
}

export class RunFeedbackRepository {
  constructor(
    private readonly deps: {
      recordRunFeedback: typeof recordRunFeedback;
      listRunFeedback: typeof listRunFeedback;
    } = {
      recordRunFeedback,
      listRunFeedback,
    },
  ) {}

  record(params: Parameters<typeof recordRunFeedback>[0]): ReturnType<typeof recordRunFeedback> {
    return this.deps.recordRunFeedback(params);
  }

  list(cwd: string, runId: string): ReturnType<typeof listRunFeedback> {
    return this.deps.listRunFeedback(cwd, runId);
  }
}

export class BudgetPolicyService {
  constructor(
    private readonly deps: {
      budgetLimitForProfile: typeof budgetLimitForProfile;
      remainingBudgetUsdEstimate: typeof remainingBudgetUsdEstimate;
      remainingBudgetAfterEstimatedCost: typeof remainingBudgetAfterEstimatedCost;
      budgetSoftCapExceeded: typeof budgetSoftCapExceeded;
      estimateAttemptCostUsd: typeof estimateAttemptCostUsd;
      assertWithinBudgetEstimate: typeof assertWithinBudgetEstimate;
    } = {
      budgetLimitForProfile,
      remainingBudgetUsdEstimate,
      remainingBudgetAfterEstimatedCost,
      budgetSoftCapExceeded,
      estimateAttemptCostUsd,
      assertWithinBudgetEstimate,
    },
  ) {}

  limitForProfile(profile: BudgetProfile): ReturnType<typeof budgetLimitForProfile> {
    return this.deps.budgetLimitForProfile(profile);
  }

  remainingUsdEstimate(params: Parameters<typeof remainingBudgetUsdEstimate>[0]): number | null {
    return this.deps.remainingBudgetUsdEstimate(params);
  }

  remainingAfterEstimatedCost(params: Parameters<typeof remainingBudgetAfterEstimatedCost>[0]): number | null {
    return this.deps.remainingBudgetAfterEstimatedCost(params);
  }

  softCapExceeded(params: Parameters<typeof budgetSoftCapExceeded>[0]): boolean {
    return this.deps.budgetSoftCapExceeded(params);
  }

  estimateAttemptCostUsd(params: {
    model: Pick<ModelEntry, "pricing">;
    capability: ModelCapability;
    contextLevel: ContextLevel;
  }): number {
    return this.deps.estimateAttemptCostUsd(params);
  }

  assertWithinEstimate(params: Parameters<typeof assertWithinBudgetEstimate>[0]): void {
    this.deps.assertWithinBudgetEstimate(params);
  }
}

export class CostLedger {
  constructor(
    private readonly deps: {
      appendAuditEvent: typeof appendAuditEvent;
      readAuditEvents: typeof readAuditEvents;
    } = {
      appendAuditEvent,
      readAuditEvents,
    },
  ) {}

  appendAuditEvent(cwd: string, event: Parameters<typeof appendAuditEvent>[1]): void {
    this.deps.appendAuditEvent(cwd, event);
  }

  readAuditEvents(cwd: string, runId?: string): ReturnType<typeof readAuditEvents> {
    return this.deps.readAuditEvents(cwd, runId);
  }
}

export class ModelInvocationLedger {
  constructor(
    private readonly deps: {
      inferAccessMode: typeof inferAccessMode;
      appendModelInvocation: typeof appendModelInvocation;
      readModelInvocations: typeof readModelInvocations;
      summarizeModelInvocations: typeof summarizeModelInvocations;
      writeModelUsageSummary: typeof writeModelUsageSummary;
      buildFinalCostReportFromModelInvocations: typeof buildFinalCostReportFromModelInvocations;
    } = {
      inferAccessMode,
      appendModelInvocation,
      readModelInvocations,
      summarizeModelInvocations,
      writeModelUsageSummary,
      buildFinalCostReportFromModelInvocations,
    },
  ) {}

  inferAccessMode(record: ModelInvocationRecord): ReturnType<typeof inferAccessMode> {
    return this.deps.inferAccessMode(record);
  }

  append(cwd: string, record: ModelInvocationRecord): string {
    return this.deps.appendModelInvocation(cwd, record);
  }

  read(cwd: string, runId: string): ModelInvocationRecord[] {
    return this.deps.readModelInvocations(cwd, runId);
  }

  summarize(params: Parameters<typeof summarizeModelInvocations>[0]): ReturnType<typeof summarizeModelInvocations> {
    return this.deps.summarizeModelInvocations(params);
  }

  writeSummary(params: Parameters<typeof writeModelUsageSummary>[0]): ReturnType<typeof writeModelUsageSummary> {
    return this.deps.writeModelUsageSummary(params);
  }

  buildFinalCostReport(
    params: Parameters<typeof buildFinalCostReportFromModelInvocations>[0],
  ): ReturnType<typeof buildFinalCostReportFromModelInvocations> {
    return this.deps.buildFinalCostReportFromModelInvocations(params);
  }
}

export class WorkspaceResolver {
  constructor(
    private readonly deps: {
      discoverWorkspaceRepos: typeof discoverWorkspaceRepos;
      resolveWorkspace: typeof resolveWorkspace;
    } = {
      discoverWorkspaceRepos,
      resolveWorkspace,
    },
  ) {}

  discoverRepos(workspacePath: string): ReturnType<typeof discoverWorkspaceRepos> {
    return this.deps.discoverWorkspaceRepos(workspacePath);
  }

  resolve(input: Parameters<typeof resolveWorkspace>[0]): ReturnType<typeof resolveWorkspace> {
    return this.deps.resolveWorkspace(input);
  }
}

export class ApprovalRepository {
  constructor(
    private readonly deps: {
      recordApprovalDecision: typeof recordApprovalDecision;
      loadApprovalDecision: typeof loadApprovalDecision;
      loadLatestApprovalDecisionForStep: typeof loadLatestApprovalDecisionForStep;
    } = {
      recordApprovalDecision,
      loadApprovalDecision,
      loadLatestApprovalDecisionForStep,
    },
  ) {}

  record(params: Parameters<typeof recordApprovalDecision>[0]): ReturnType<typeof recordApprovalDecision> {
    return this.deps.recordApprovalDecision(params);
  }

  load(params: Parameters<typeof loadApprovalDecision>[0]): ReturnType<typeof loadApprovalDecision> {
    return this.deps.loadApprovalDecision(params);
  }

  loadLatestForStep(
    params: Parameters<typeof loadLatestApprovalDecisionForStep>[0],
  ): ReturnType<typeof loadLatestApprovalDecisionForStep> {
    return this.deps.loadLatestApprovalDecisionForStep(params);
  }
}

export class EvidenceRepository {
  constructor(
    private readonly deps: {
      listStepAttemptEvidence: typeof listStepAttemptEvidence;
      latestAttemptByStep: typeof latestAttemptByStep;
      assertStepDependenciesCompleted: typeof assertStepDependenciesCompleted;
    } = {
      listStepAttemptEvidence,
      latestAttemptByStep,
      assertStepDependenciesCompleted,
    },
  ) {}

  listStepAttempts(cwd: string, runId: string): StepAttemptEvidence[] {
    return this.deps.listStepAttemptEvidence(cwd, runId);
  }

  latestAttemptByStep(attempts: StepAttemptEvidence[]): Map<string, StepAttemptEvidence> {
    return this.deps.latestAttemptByStep(attempts);
  }

  assertStepDependenciesCompleted(params: Parameters<typeof assertStepDependenciesCompleted>[0]): void {
    this.deps.assertStepDependenciesCompleted(params);
  }
}

export class RunLockService {
  constructor(
    private readonly deps: {
      acquireRunLock: typeof acquireRunLock;
      withRunLock: typeof withRunLock;
    } = {
      acquireRunLock,
      withRunLock,
    },
  ) {}

  acquire(params: Parameters<typeof acquireRunLock>[0]): RunLock {
    return this.deps.acquireRunLock(params);
  }

  withLock<T>(params: Parameters<typeof withRunLock<T>>[0], action: Parameters<typeof withRunLock<T>>[1]): Promise<T> {
    return this.deps.withRunLock(params, action);
  }
}

export interface CoreServices {
  artifacts: RunArtifactStore;
  config: KiwiConfigRepository;
  runs: RunStore;
  runStatus: RunStatusReader;
  feedback: RunFeedbackRepository;
  budgets: BudgetPolicyService;
  costs: CostLedger;
  modelInvocations: ModelInvocationLedger;
  workspaces: WorkspaceResolver;
  approvals: ApprovalRepository;
  evidence: EvidenceRepository;
  locks: RunLockService;
}

export function createCoreServices(): CoreServices {
  return {
    artifacts: new RunArtifactStore(),
    config: new KiwiConfigRepository(),
    runs: new RunStore(),
    runStatus: new RunStatusReader(),
    feedback: new RunFeedbackRepository(),
    budgets: new BudgetPolicyService(),
    costs: new CostLedger(),
    modelInvocations: new ModelInvocationLedger(),
    workspaces: new WorkspaceResolver(),
    approvals: new ApprovalRepository(),
    evidence: new EvidenceRepository(),
    locks: new RunLockService(),
  };
}
