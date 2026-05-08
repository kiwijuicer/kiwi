import { existsSync } from "fs";
import path from "path";
import { ContractValues, RunStatus } from "@kiwi/contracts";
import { RunCorruptError, RunNotFoundError } from "./errors";
import { listRunIds, loadInitiative, loadRunManifest, loadTaskGraph } from "./run-store";
import { listStepAttemptEvidence } from "./lifecycle";

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

export interface RunStatusEntry {
  runId: string;
  status: RunStatus;
  updatedAt: string;
  workspacePath?: string;
  repoId?: string;
  repoPath?: string;
  initiativeTitle: string;
  currentPlanId: string;
  stepCount: number;
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

function attemptStatusEntries(runId: string, cwd: string): RunAttemptStatusEntry[] {
  return listStepAttemptEvidence(cwd, runId).map((entry) => {
    const blocked = entry.gateResults.some((gate) => gate.status === ContractValues.Blocked);
    const failed = entry.gateResults.some((gate) => gate.status === ContractValues.Fail);
    const gateStatus = blocked
      ? ContractValues.Blocked
      : failed
        ? ContractValues.Fail
        : entry.gateResults.length > 0
          ? ContractValues.Pass
          : "missing";

    return {
      stepId: entry.stepId,
      attemptId: entry.attemptId,
      status: entry.attempt.status,
      runner: entry.attempt.runner,
      gateStatus,
      reviewVerdict: entry.reviewVerdict?.verdict ?? "missing",
      nextAction: entry.summary?.nextAction.type ?? "missing",
      artifacts: entry.attempt.artifacts.map((artifact) => artifact.ref),
    };
  });
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

  const entry: RunStatusEntry = {
    runId,
    status: run.status,
    updatedAt: run.updatedAt,
    initiativeTitle: initiative.title,
    currentPlanId: run.currentPlanId,
    stepCount: taskGraph.steps.length,
    attempts: attemptStatusEntries(runId, cwd),
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
    planned: entries.filter((entry) => entry.status === "planned").length,
    running: entries.filter((entry) => entry.status === ContractValues.Running).length,
    needsApproval: entries.filter((entry) => entry.status === "needs_approval").length,
    completed: entries.filter((entry) => entry.status === ContractValues.Completed).length,
    failed: entries.filter((entry) => entry.status === ContractValues.Failed).length,
    cancelled: entries.filter((entry) => entry.status === ContractValues.Cancelled).length,
    latest: entries.slice(0, 10),
    corrupt,
  };
}
