import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";
import {
  Initiative,
  RunManifest,
  RunManifestSchema,
  TaskGraph,
  TaskGraphSchema,
} from "@ai-kiwi/contracts";
import { RunNotFoundError } from "./errors";

function runsRoot(cwd: string): string {
  return path.join(cwd, ".kiwi", "runs");
}

function runDir(runId: string, cwd: string): string {
  return path.join(runsRoot(cwd), runId);
}

function writeJson(target: string, value: unknown): void {
  writeFileSync(target, JSON.stringify(value, null, 2), "utf-8");
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
  now?: Date;
}): RunManifest {
  if (params.taskGraph.runId !== params.runId) {
    throw new Error("taskGraph.runId must match runId");
  }

  const now = (params.now ?? new Date()).toISOString();
  const manifest: RunManifest = {
    runId: params.runId,
    initiativeId: params.initiative.id,
    currentPlanId: params.taskGraph.planId,
    status: "planned",
    createdAt: now,
    updatedAt: now,
  };

  const base = runDir(params.runId, params.cwd);
  mkdirSync(path.join(base, "plan"), { recursive: true });

  writeJson(path.join(base, "run.json"), manifest);
  writeJson(path.join(base, "initiative.json"), params.initiative);
  writeJson(path.join(base, "plan", "task-graph.json"), params.taskGraph);
  if (params.plannerInput !== undefined) {
    writeJson(path.join(base, "plan", "planner-input.json"), params.plannerInput);
  }
  if (params.plannerOutput !== undefined) {
    writeJson(path.join(base, "plan", "planner-output.json"), params.plannerOutput);
  }

  return manifest;
}

export function loadRunManifest(runId: string, cwd: string): RunManifest {
  const target = path.join(runDir(runId, cwd), "run.json");
  if (!existsSync(target)) {
    throw new RunNotFoundError(runId);
  }
  return RunManifestSchema.parse(readJson(target));
}

export function loadTaskGraph(runId: string, cwd: string): TaskGraph {
  const target = path.join(runDir(runId, cwd), "plan", "task-graph.json");
  if (!existsSync(target)) {
    throw new RunNotFoundError(runId);
  }
  return TaskGraphSchema.parse(readJson(target));
}

export function listRunManifests(cwd: string): RunManifest[] {
  const root = runsRoot(cwd);
  if (!existsSync(root)) return [];

  const runIds = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const manifests: RunManifest[] = [];
  for (const runId of runIds) {
    const target = path.join(runDir(runId, cwd), "run.json");
    if (!existsSync(target)) continue;
    manifests.push(RunManifestSchema.parse(readJson(target)));
  }

  return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
