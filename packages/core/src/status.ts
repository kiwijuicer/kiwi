import { existsSync, readFileSync } from "fs";
import path from "path";
import { ContractValues, RunStatus, Step, StepType } from "@kiwi/contracts";
import { RunCorruptError, RunNotFoundError } from "./errors";
import { listRunIds, loadInitiative, loadRunManifest, loadTaskGraph, resolveRunArtifactPath } from "./run-store";
import { latestAttemptByStep, listStepAttemptEvidence, StepAttemptEvidence } from "./lifecycle";

export interface RunArtifactPaths {
  runManifest: string;
  initiative: string;
  taskGraph: string;
  finalSummary?: string;
  finalVerdict?: string;
  finalCostReport?: string;
  auditSnapshot?: string;
  evidenceManifest?: string;
  operatorSnapshot?: string;
}

export interface RunAttemptStatusEntry {
  stepId: string;
  attemptId: string;
  status: string;
  runner: string;
  gateStatus: "pass" | "fail" | "blocked" | "missing";
  reviewVerdict: string | "missing";
  nextAction: string | "missing";
  artifacts: string[];
}

export interface RunEditedFileEntry {
  path: string;
  stepId: string;
  attemptId: string;
  diffRef: string;
}

export interface RunStepStatusEntry {
  stepId: string;
  title: string;
  type: StepType;
  dependsOn: string[];
  plannedStatus: string;
  status: string;
  editedFiles: string[];
  latestAttemptId?: string;
  runner?: string;
  startedAt?: string;
  completedAt?: string | null;
  gateStatus?: "pass" | "fail" | "blocked" | "missing";
  reviewVerdict?: string | "missing";
  nextAction?: string | "missing";
}

export interface RunCompletedStepEntry {
  stepId: string;
  title: string;
  attemptId: string;
  completedAt: string | null;
}

export interface RunActiveStepActivityEntry {
  stepId: string;
  title: string;
  attemptId: string;
  status: string;
  runner: string;
  startedAt: string;
  contextPackageRef: string;
  schedulerStatus?: string;
  routingReason?: string[];
  selectedModelId?: string | null;
  selectedProviderModel?: string | null;
  selectedAccessMode?: string | null;
  estimatedAttemptCostUsd?: number;
  executionIsolation?: string;
}

export interface RunStatusEntry {
  runId: string;
  status: RunStatus;
  currentStatus: RunStatus;
  updatedAt: string;
  workspacePath?: string;
  repoId?: string;
  repoPath?: string;
  initiativeTitle: string;
  currentPlanId: string;
  stepCount: number;
  steps: RunStepStatusEntry[];
  completedSteps: RunCompletedStepEntry[];
  remainingSteps: RunStepStatusEntry[];
  activeStepActivity: RunActiveStepActivityEntry[];
  editedFiles: RunEditedFileEntry[];
  attempts: RunAttemptStatusEntry[];
  artifactPaths: RunArtifactPaths;
}

export interface CorruptRunStatusEntry {
  runId: string;
  error: string;
}

export interface RunStatusSummary {
  total: number;
  planned: number;
  running: number;
  needsApproval: number;
  completed: number;
  failed: number;
  cancelled: number;
  latest: RunStatusEntry[];
  corrupt: CorruptRunStatusEntry[];
}

function artifactPathsFor(runId: string): RunArtifactPaths {
  const paths: RunArtifactPaths = {
    runManifest: `.kiwi/runs/${runId}/run.json`,
    initiative: `.kiwi/runs/${runId}/initiative.json`,
    taskGraph: `.kiwi/runs/${runId}/plan/task-graph.json`,
  };
  return paths;
}

function finalArtifactPathsFor(runId: string, cwd: string): Partial<RunArtifactPaths> {
  const candidates = {
    finalSummary: `.kiwi/runs/${runId}/final/final-summary.md`,
    finalVerdict: `.kiwi/runs/${runId}/final/final-verdict.json`,
    finalCostReport: `.kiwi/runs/${runId}/final/final-cost-report.json`,
    auditSnapshot: `.kiwi/runs/${runId}/final/audit-events.json`,
    evidenceManifest: `.kiwi/runs/${runId}/final/evidence-manifest.json`,
    operatorSnapshot: `.kiwi/runs/${runId}/operator/index.html`,
  };
  const existing: Partial<RunArtifactPaths> = {};
  for (const [key, relative] of Object.entries(candidates)) {
    if (existsSync(path.join(cwd, relative))) {
      existing[key as keyof RunArtifactPaths] = relative;
    }
  }
  return existing;
}

function gateStatusFor(entry: StepAttemptEvidence): "pass" | "fail" | "blocked" | "missing" {
  const blocked = entry.gateResults.some((gate) => gate.status === ContractValues.Blocked);
  const failed = entry.gateResults.some((gate) => gate.status === ContractValues.Fail);
  if (blocked) return ContractValues.Blocked;
  if (failed) return ContractValues.Fail;
  return entry.gateResults.length > 0 ? ContractValues.Pass : "missing";
}

function attemptStatusEntries(attempts: StepAttemptEvidence[]): RunAttemptStatusEntry[] {
  return attempts.map((entry) => {
    return {
      stepId: entry.stepId,
      attemptId: entry.attemptId,
      status: entry.attempt.status,
      runner: entry.attempt.runner,
      gateStatus: gateStatusFor(entry),
      reviewVerdict: entry.reviewVerdict?.verdict ?? "missing",
      nextAction: entry.summary?.nextAction.type ?? "missing",
      artifacts: entry.attempt.artifacts.map((artifact) => artifact.ref),
    };
  });
}

function normalizeDiffPath(rawPath: string): string | null {
  const withoutMetadata = rawPath.trim().split(/\t/, 1)[0];
  if (!withoutMetadata || withoutMetadata === "/dev/null") return null;
  const unquoted =
    withoutMetadata.startsWith('"') && withoutMetadata.endsWith('"')
      ? withoutMetadata.slice(1, -1).replace(/\\"/g, '"')
      : withoutMetadata;
  return unquoted.replace(/^[ab]\//, "");
}

function addDiffPath(paths: Set<string>, rawPath: string): void {
  const normalized = normalizeDiffPath(rawPath);
  if (normalized) paths.add(normalized);
}

function parseDiffEditedFiles(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("--- ")) addDiffPath(paths, line.slice(4));
    if (line.startsWith("+++ ")) addDiffPath(paths, line.slice(4));
    if (line.startsWith("diff --git ") || line.startsWith("diff --kiwi ")) {
      const [, left, right] = line.match(/^diff --(?:git|kiwi)\s+(\S+)\s+(\S+)/) ?? [];
      if (left) addDiffPath(paths, left);
      if (right) addDiffPath(paths, right);
    }
  }
  return Array.from(paths).sort();
}

function editedFilesForAttempt(cwd: string, runId: string, attempt: StepAttemptEvidence): RunEditedFileEntry[] {
  return attempt.attempt.artifacts.flatMap((artifact): RunEditedFileEntry[] => {
    if (artifact.type !== "diff") return [];
    let target: string;
    try {
      target = resolveRunArtifactPath(runId, artifact.ref, cwd);
    } catch {
      return [];
    }
    if (!existsSync(target)) return [];
    let patch: string;
    try {
      patch = readFileSync(target, "utf-8");
    } catch {
      return [];
    }
    return parseDiffEditedFiles(patch).map((filePath) => ({
      path: filePath,
      stepId: attempt.stepId,
      attemptId: attempt.attemptId,
      diffRef: artifact.ref,
    }));
  });
}

function latestStepEntries(params: {
  cwd: string;
  runId: string;
  steps: Step[];
  latestAttempts: Map<string, StepAttemptEvidence>;
}): {
  steps: RunStepStatusEntry[];
  completedSteps: RunCompletedStepEntry[];
  remainingSteps: RunStepStatusEntry[];
  activeStepActivity: RunActiveStepActivityEntry[];
  editedFiles: RunEditedFileEntry[];
} {
  const completedSteps: RunCompletedStepEntry[] = [];
  const remainingSteps: RunStepStatusEntry[] = [];
  const activeStepActivity: RunActiveStepActivityEntry[] = [];
  const editedFiles: RunEditedFileEntry[] = [];
  const stepEntries = params.steps.map((step): RunStepStatusEntry => {
    const latest = params.latestAttempts.get(step.stepId);
    const attemptEditedFiles = latest ? editedFilesForAttempt(params.cwd, params.runId, latest) : [];
    editedFiles.push(...attemptEditedFiles);

    const entry: RunStepStatusEntry = {
      stepId: step.stepId,
      title: step.title,
      type: step.type,
      dependsOn: step.dependsOn,
      plannedStatus: step.status,
      status: latest?.attempt.status ?? step.status,
      editedFiles: attemptEditedFiles.map((item) => item.path),
    };

    if (latest) {
      entry.latestAttemptId = latest.attemptId;
      entry.runner = latest.attempt.runner;
      entry.startedAt = latest.attempt.startedAt;
      entry.completedAt = latest.attempt.completedAt;
      entry.gateStatus = gateStatusFor(latest);
      entry.reviewVerdict = latest.reviewVerdict?.verdict ?? "missing";
      entry.nextAction = latest.summary?.nextAction.type ?? "missing";
    }

    if (entry.status === ContractValues.Completed && latest) {
      completedSteps.push({
        stepId: step.stepId,
        title: step.title,
        attemptId: latest.attemptId,
        completedAt: latest.attempt.completedAt,
      });
    } else {
      remainingSteps.push(entry);
    }

    if (latest?.attempt.status === ContractValues.Running || latest?.attempt.status === ContractValues.Pending) {
      const activity: RunActiveStepActivityEntry = {
        stepId: step.stepId,
        title: step.title,
        attemptId: latest.attemptId,
        status: latest.attempt.status,
        runner: latest.attempt.runner,
        startedAt: latest.attempt.startedAt,
        contextPackageRef: latest.attempt.contextPackageRef,
      };
      if (latest.schedulerDecision) {
        activity.schedulerStatus = latest.schedulerDecision.status;
        activity.routingReason = latest.schedulerDecision.routingReason;
        activity.selectedModelId = latest.schedulerDecision.selectedModelId ?? null;
        activity.selectedProviderModel = latest.schedulerDecision.selectedProviderModel ?? null;
        activity.selectedAccessMode = latest.schedulerDecision.selectedAccessMode ?? null;
        if (latest.schedulerDecision.estimatedAttemptCostUsd !== undefined) {
          activity.estimatedAttemptCostUsd = latest.schedulerDecision.estimatedAttemptCostUsd;
        }
        if (latest.schedulerDecision.executionIsolation) {
          activity.executionIsolation = latest.schedulerDecision.executionIsolation;
        }
      }
      activeStepActivity.push(activity);
    }

    return entry;
  });

  return { steps: stepEntries, completedSteps, remainingSteps, activeStepActivity, editedFiles };
}

function deriveCurrentRunStatus(params: {
  manifestStatus: RunStatus;
  steps: Step[];
  latestAttempts: Map<string, StepAttemptEvidence>;
}): RunStatus {
  if (params.manifestStatus === ContractValues.Cancelled) return params.manifestStatus;
  const attempts = Array.from(params.latestAttempts.values());
  if (attempts.length === 0) return params.manifestStatus;
  if (attempts.some((entry) => entry.attempt.status === ContractValues.Blocked)) return "needs_approval";
  if (attempts.some((entry) => entry.attempt.status === ContractValues.Failed)) return ContractValues.Failed;
  if (
    attempts.some(
      (entry) => entry.attempt.status === ContractValues.Running || entry.attempt.status === ContractValues.Pending,
    )
  ) {
    return ContractValues.Running;
  }

  const completedStepIds = new Set(
    attempts.filter((entry) => entry.attempt.status === ContractValues.Completed).map((entry) => entry.stepId),
  );
  if (params.steps.every((step) => completedStepIds.has(step.stepId))) return ContractValues.Completed;
  if (completedStepIds.size > 0) return ContractValues.Running;
  return params.manifestStatus;
}

function assertRunFolderReadable(runId: string, cwd: string): void {
  const paths = artifactPathsFor(runId);
  const required = [paths.runManifest, paths.initiative, paths.taskGraph];
  for (const relative of required) {
    const absPath = path.join(cwd, relative);
    if (!existsSync(absPath)) {
      throw new RunCorruptError(runId, `missing required artifact ${relative}`);
    }
  }
}

function loadRunStatusEntry(runId: string, cwd: string): RunStatusEntry {
  assertRunFolderReadable(runId, cwd);
  const run = loadRunManifest(runId, cwd);
  const initiative = loadInitiative(runId, cwd);
  const taskGraph = loadTaskGraph(runId, cwd);
  const attempts = listStepAttemptEvidence(cwd, runId);
  const latestAttempts = latestAttemptByStep(attempts);
  const stepDetails = latestStepEntries({
    cwd,
    runId,
    steps: taskGraph.steps,
    latestAttempts,
  });

  const entry: RunStatusEntry = {
    runId,
    status: run.status,
    currentStatus: deriveCurrentRunStatus({
      manifestStatus: run.status,
      steps: taskGraph.steps,
      latestAttempts,
    }),
    updatedAt: run.updatedAt,
    initiativeTitle: initiative.title,
    currentPlanId: run.currentPlanId,
    stepCount: taskGraph.steps.length,
    steps: stepDetails.steps,
    completedSteps: stepDetails.completedSteps,
    remainingSteps: stepDetails.remainingSteps,
    activeStepActivity: stepDetails.activeStepActivity,
    editedFiles: stepDetails.editedFiles,
    attempts: attemptStatusEntries(attempts),
    artifactPaths: {
      ...artifactPathsFor(runId),
      ...finalArtifactPathsFor(runId, cwd),
    },
  };
  if (run.workspacePath) entry.workspacePath = run.workspacePath;
  if (run.repoId) entry.repoId = run.repoId;
  if (run.repoPath) entry.repoPath = run.repoPath;
  return entry;
}

export function getRunStatusSummary(cwd: string, runId?: string): RunStatusSummary {
  const runIds = listRunIds(cwd);
  if (runId && !runIds.includes(runId)) {
    throw new RunNotFoundError(runId);
  }

  const selectedRunIds = runId ? [runId] : runIds;
  const entries: RunStatusEntry[] = [];
  const corrupt: CorruptRunStatusEntry[] = [];
  for (const id of selectedRunIds) {
    try {
      entries.push(loadRunStatusEntry(id, cwd));
    } catch (error) {
      if (runId || !(error instanceof RunCorruptError)) throw error;
      corrupt.push({ runId: id, error: error.message });
    }
  }
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    total: entries.length + corrupt.length,
    planned: entries.filter((entry) => entry.currentStatus === "planned").length,
    running: entries.filter((entry) => entry.currentStatus === ContractValues.Running).length,
    needsApproval: entries.filter((entry) => entry.currentStatus === "needs_approval").length,
    completed: entries.filter((entry) => entry.currentStatus === ContractValues.Completed).length,
    failed: entries.filter((entry) => entry.currentStatus === ContractValues.Failed).length,
    cancelled: entries.filter((entry) => entry.currentStatus === ContractValues.Cancelled).length,
    latest: entries.slice(0, 10),
    corrupt,
  };
}
