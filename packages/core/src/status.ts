import { existsSync } from "fs";
import path from "path";
import { RunStatus } from "@ai-kiwi/contracts";
import { RunCorruptError, RunNotFoundError } from "./errors";
import {
  listRunIds,
  loadInitiative,
  loadRunManifest,
  loadTaskGraph,
} from "./run-store";

export interface RunArtifactPaths {
  runManifest: string;
  initiative: string;
  taskGraph: string;
}

export interface RunStatusEntry {
  runId: string;
  status: RunStatus;
  updatedAt: string;
  initiativeTitle: string;
  currentPlanId: string;
  stepCount: number;
  artifactPaths: RunArtifactPaths;
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
}

function artifactPathsFor(runId: string): RunArtifactPaths {
  return {
    runManifest: `.kiwi/runs/${runId}/run.json`,
    initiative: `.kiwi/runs/${runId}/initiative.json`,
    taskGraph: `.kiwi/runs/${runId}/plan/task-graph.json`,
  };
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

  return {
    runId,
    status: run.status,
    updatedAt: run.updatedAt,
    initiativeTitle: initiative.title,
    currentPlanId: run.currentPlanId,
    stepCount: taskGraph.steps.length,
    artifactPaths: artifactPathsFor(runId),
  };
}

export function getRunStatusSummary(cwd: string, runId?: string): RunStatusSummary {
  const runIds = listRunIds(cwd);
  if (runId && !runIds.includes(runId)) {
    throw new RunNotFoundError(runId);
  }

  const selectedRunIds = runId ? [runId] : runIds;
  const entries = selectedRunIds
    .map((id) => loadRunStatusEntry(id, cwd))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    total: entries.length,
    planned: entries.filter((entry) => entry.status === "planned").length,
    running: entries.filter((entry) => entry.status === "running").length,
    needsApproval: entries.filter((entry) => entry.status === "needs_approval").length,
    completed: entries.filter((entry) => entry.status === "completed").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
    cancelled: entries.filter((entry) => entry.status === "cancelled").length,
    latest: entries.slice(0, 10),
  };
}
