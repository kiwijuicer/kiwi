import { existsSync, readFileSync } from "fs";
import path from "path";
import { ContextPackageSchema, ModelCapabilitySchema, SchedulerDecisionSchema } from "@kiwi/contracts";
import { resolveRunArtifactPath, writeJsonSafely } from "@kiwi/core";
import type { ContextLevel, ContextPackage, SchedulerDecision, SchedulerInput } from "./scheduler-types";
import { mutationRequirementForStepType } from "./mutation-requirement";

function sanitizeList(entries: string[], limit: number): string[] {
  return entries
    .filter((entry) => entry.trim().length > 0)
    .filter((entry) => !entry.includes("*"))
    .slice(0, limit);
}

function safeRelativePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }

  return normalized;
}

function readFileSnapshot(params: {
  repoPath: string;
  filePath: string;
  maxBytes: number;
}): ContextPackage["files"][number] | null {
  const relative = safeRelativePath(params.filePath);

  if (!relative) {
    return null;
  }
  const root = path.resolve(params.repoPath);
  const target = path.resolve(root, relative);

  if (!(target === root || target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) {
    return null;
  }
  const buffer = readFileSync(target);
  const truncated = buffer.byteLength > params.maxBytes;
  const content = buffer.subarray(0, params.maxBytes).toString("utf-8");

  return {
    path: relative,
    content,
    truncated,
    bytes: buffer.byteLength,
  };
}

function fileSnapshotPaths(params: {
  level: ContextLevel;
  relevantFiles: string[];
  testFiles: string[];
  recentDiffFiles: string[];
  architectureFiles: string[];
}): string[] {
  if (params.level === "L0") {
    return [];
  }
  const paths = new Set<string>();

  for (const file of [...params.relevantFiles, ...params.testFiles]) {
    paths.add(file);
  }
  if (params.level === "L2" || params.level === "L3") {
    for (const file of params.recentDiffFiles) {
      paths.add(file);
    }
  }
  if (params.level === "L3") {
    for (const file of params.architectureFiles) {
      paths.add(file);
    }
  }

  return Array.from(paths);
}

class SchedulerContextPackageService {
  readContextPackage(params: { cwd: string; runId: string; stepId: string; attemptId: string }): ContextPackage {
    const relative = `steps/${params.stepId}/${params.attemptId}/context-package.json`;
    const target = resolveRunArtifactPath(params.runId, relative, params.cwd);

    if (!existsSync(target)) {
      throw new Error(`context package not found: ${relative}`);
    }

    return ContextPackageSchema.parse(JSON.parse(readFileSync(target, "utf-8"))) as ContextPackage;
  }

  readSchedulerDecision(params: { cwd: string; runId: string; stepId: string; attemptId: string }): SchedulerDecision {
    const relative = `steps/${params.stepId}/${params.attemptId}/scheduler-decision.json`;
    const target = resolveRunArtifactPath(params.runId, relative, params.cwd);

    if (!existsSync(target)) {
      throw new Error(`scheduler decision not found: ${relative}`);
    }

    return SchedulerDecisionSchema.parse(JSON.parse(readFileSync(target, "utf-8"))) as SchedulerDecision;
  }

  writeContextPackage(cwd: string, contextPackage: ContextPackage): string {
    const relative = `steps/${contextPackage.stepId}/${contextPackage.attemptId}/context-package.json`;
    const target = resolveRunArtifactPath(contextPackage.runId, relative, cwd);
    writeJsonSafely(target, ContextPackageSchema.parse(contextPackage));

    return relative;
  }

  buildContextPackage(params: {
    input: SchedulerInput;
    runId: string;
    stepId: string;
    attemptId: string;
    level: ContextLevel;
    now: Date;
    relevantFiles: string[];
    testFiles: string[];
    recentDiffFiles: string[];
    symbolHits: string[];
    traces: string[];
    architectureFiles: string[];
    historicalOutcomeRefs: string[];
    retrieval: ContextPackage["retrieval"];
  }): ContextPackage {
    const levelLimits: Record<ContextLevel, number> = { L0: 4, L1: 12, L2: 25, L3: 40 };
    const limit = levelLimits[params.level];
    const fileMaxBytes: Record<ContextLevel, number> = { L0: 0, L1: 16_000, L2: 28_000, L3: 40_000 };
    const snapshotPaths = fileSnapshotPaths({
      level: params.level,
      relevantFiles: sanitizeList(params.relevantFiles, limit),
      testFiles: sanitizeList(params.testFiles, Math.max(4, Math.floor(limit / 2))),
      recentDiffFiles: sanitizeList(params.recentDiffFiles, Math.max(4, Math.floor(limit / 2))),
      architectureFiles: sanitizeList(params.architectureFiles, Math.max(4, Math.floor(limit / 2))),
    });

    return ContextPackageSchema.parse({
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      level: params.level,
      initiative: {
        title: params.input.initiative.title,
        rawInput: params.input.initiative.rawInput,
        riskProfile: params.input.initiative.riskProfile,
        budgetProfile: params.input.initiative.budgetProfile,
      },
      task: {
        stepId: params.input.step.stepId,
        type: params.input.step.type,
        title: params.input.step.title,
        successCriteria: params.input.step.successCriteria,
        requiredGates: params.input.step.requiredGates,
        acceptanceCriteria: params.input.taskGraph?.acceptanceCriteria ?? params.input.step.successCriteria,
      },
      mutationRequirement: mutationRequirementForStepType(params.input.step.type),
      files: snapshotPaths
        .map((filePath) =>
          readFileSnapshot({
            repoPath: params.input.initiative.repoPath || params.input.cwd,
            filePath,
            maxBytes: fileMaxBytes[params.level],
          }),
        )
        .filter((entry): entry is ContextPackage["files"][number] => entry !== null),
      commands: {
        test: params.input.policy?.commands.test ?? "not configured",
        lint: params.input.policy?.commands.lint ?? "not configured",
        typecheck: params.input.policy?.commands.typecheck ?? "not configured",
      },
      budget: {
        modelCapability: ModelCapabilitySchema.parse(params.input.step.recommendedModelCapability),
        contextLevel: params.level,
        selectedModelId: null,
        selectedProviderModel: null,
        estimatedAttemptCostUsd: null,
      },
      include: {
        initiative: true,
        policy: true,
        registry: true,
        commands: true,
        relevantFiles: sanitizeList(params.relevantFiles, limit),
        tests: sanitizeList(params.testFiles, Math.max(4, Math.floor(limit / 2))),
        recentDiffFiles: sanitizeList(params.recentDiffFiles, Math.max(4, Math.floor(limit / 2))),
        symbolHits: sanitizeList(params.symbolHits, limit),
        traces: sanitizeList(params.traces, Math.max(2, Math.floor(limit / 3))),
        architectureFiles: sanitizeList(params.architectureFiles, Math.max(4, Math.floor(limit / 2))),
        historicalOutcomeRefs: sanitizeList(params.historicalOutcomeRefs, Math.max(2, Math.floor(limit / 3))),
      },
      retrieval: params.retrieval,
      generatedAt: params.now.toISOString(),
    });
  }
}

const schedulerContextPackageService = new SchedulerContextPackageService();

export function readContextPackage(
  params: Parameters<SchedulerContextPackageService["readContextPackage"]>[0],
): ContextPackage {
  return schedulerContextPackageService.readContextPackage(params);
}

export function readSchedulerDecision(
  params: Parameters<SchedulerContextPackageService["readSchedulerDecision"]>[0],
): SchedulerDecision {
  return schedulerContextPackageService.readSchedulerDecision(params);
}

export function writeContextPackage(cwd: string, contextPackage: ContextPackage): string {
  return schedulerContextPackageService.writeContextPackage(cwd, contextPackage);
}

export function buildContextPackage(
  params: Parameters<SchedulerContextPackageService["buildContextPackage"]>[0],
): ContextPackage {
  return schedulerContextPackageService.buildContextPackage(params);
}
