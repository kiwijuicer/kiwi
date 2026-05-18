import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import path from "path";
import {
  Initiative,
  InitiativeSchema,
  RunManifest,
  RunManifestSchema,
  TaskGraph,
  TaskGraphSchema,
} from "@kiwi/contracts";
import { RunNotFoundError } from "../errors";
import { writeJsonSafely } from "../storage/json-io";

function runsRoot(cwd: string): string {
  return path.join(cwd, ".kiwi", "runs");
}

const RUN_ID_PATTERN = /^run_[a-z0-9_]+$/;

export function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

function assertValidRunId(runId: string): void {
  if (!isValidRunId(runId)) {
    throw new Error("runId must look like run_<value>");
  }
}

function runDir(runId: string, cwd: string): string {
  assertValidRunId(runId);

  return path.join(runsRoot(cwd), runId);
}

function assertSafeArtifactRelativePath(artifactRelativePath: string): void {
  if (path.isAbsolute(artifactRelativePath)) {
    throw new Error("artifact path must be relative to run directory");
  }
}

export function resolveRunArtifactPath(runId: string, artifactRelativePath: string, cwd: string): string {
  assertSafeArtifactRelativePath(artifactRelativePath);

  const base = path.resolve(runDir(runId, cwd));
  const target = path.resolve(base, artifactRelativePath);

  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`artifact path escapes run directory: ${artifactRelativePath}`);
  }

  return target;
}

export interface RunLayout {
  baseDir: string;
  planDir: string;
  stepsDir: string;
  finalDir: string;
}

export function ensureRunLayout(runId: string, cwd: string): RunLayout {
  const baseDir = runDir(runId, cwd);
  const planDir = path.join(baseDir, "plan");
  const stepsDir = path.join(baseDir, "steps");
  const finalDir = path.join(baseDir, "final");

  mkdirSync(planDir, { recursive: true });
  mkdirSync(stepsDir, { recursive: true });
  mkdirSync(finalDir, { recursive: true });

  return { baseDir, planDir, stepsDir, finalDir };
}

function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

export function isInitialized(cwd: string): boolean {
  return existsSync(path.join(cwd, ".kiwi", "config.yaml"));
}

export function savePlannedRun(params: {
  runId: string;
  initiative: Initiative;
  taskGraph: TaskGraph;
  plannerInput?: unknown;
  plannerOutput?: unknown;
  cwd: string;
  workspacePath?: string;
  repoId?: string;
  repoPath?: string;
  now?: Date;
}): RunManifest {
  if (params.taskGraph.runId !== params.runId) {
    throw new Error("taskGraph.runId must match runId");
  }

  const now = (params.now ?? new Date()).toISOString();
  const manifestInput: Record<string, unknown> = {
    runId: params.runId,
    initiativeId: params.initiative.id,
    currentPlanId: params.taskGraph.planId,
    status: "planned",
    createdAt: now,
    updatedAt: now,
  };

  if (params.workspacePath) {
    manifestInput.workspacePath = params.workspacePath;
  }
  if (params.repoId) {
    manifestInput.repoId = params.repoId;
  }
  if (params.repoPath) {
    manifestInput.repoPath = params.repoPath;
  }
  const manifest = RunManifestSchema.parse(manifestInput);

  const initiative = InitiativeSchema.parse(params.initiative);
  const taskGraph = TaskGraphSchema.parse(params.taskGraph);

  const layout = ensureRunLayout(params.runId, params.cwd);

  writeJsonSafely(path.join(layout.baseDir, "run.json"), manifest);
  writeJsonSafely(path.join(layout.baseDir, "initiative.json"), initiative);
  writeJsonSafely(path.join(layout.planDir, "task-graph.json"), taskGraph);
  if (params.plannerInput !== undefined) {
    writeJsonSafely(path.join(layout.planDir, "planner-input.json"), params.plannerInput);
  }
  if (params.plannerOutput !== undefined) {
    writeJsonSafely(path.join(layout.planDir, "planner-output.json"), params.plannerOutput);
  }

  return manifest;
}

export function loadInitiative(runId: string, cwd: string): Initiative {
  const target = resolveRunArtifactPath(runId, "initiative.json", cwd);

  if (!existsSync(target)) {
    throw new RunNotFoundError(runId);
  }

  return InitiativeSchema.parse(readJson(target));
}

export function loadRunManifest(runId: string, cwd: string): RunManifest {
  const target = resolveRunArtifactPath(runId, "run.json", cwd);

  if (!existsSync(target)) {
    throw new RunNotFoundError(runId);
  }

  return RunManifestSchema.parse(readJson(target));
}

export function loadTaskGraph(runId: string, cwd: string): TaskGraph {
  const baseTarget = resolveRunArtifactPath(runId, "plan/task-graph.json", cwd);

  if (!existsSync(baseTarget)) {
    throw new RunNotFoundError(runId);
  }

  // Prefer the highest-versioned task-graph.vN.json when one exists (written by replanner)
  const planDir = path.dirname(baseTarget);
  const versioned = readdirSync(planDir)
    .map((f) => ({ f, m: f.match(/^task-graph\.v(\d+)\.json$/) }))
    .filter(({ m }) => m !== null)
    .map(({ f, m }) => ({ f, v: parseInt(m![1]!, 10) }))
    .sort((a, b) => b.v - a.v);

  const target = versioned[0] ? path.join(planDir, versioned[0].f) : baseTarget;

  return TaskGraphSchema.parse(readJson(target));
}

export function listRunManifests(cwd: string): RunManifest[] {
  const root = runsRoot(cwd);

  if (!existsSync(root)) {
    return [];
  }

  const runIds = listRunIds(cwd).filter(isValidRunId);

  const manifests: RunManifest[] = [];

  for (const runId of runIds) {
    const target = resolveRunArtifactPath(runId, "run.json", cwd);

    if (!existsSync(target)) {
      continue;
    }
    manifests.push(RunManifestSchema.parse(readJson(target)));
  }

  return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listRunIds(cwd: string): string[] {
  const root = runsRoot(cwd);

  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
