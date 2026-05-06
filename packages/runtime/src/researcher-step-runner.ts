import { existsSync, readFileSync } from "fs";
import {
  AccessMode,
  ArtifactSchema,
  ContractValues,
  GateResultSchema,
  InitiativeSchema,
  KiwiPolicy,
  ModelEntry,
  RunnerNames,
} from "@kiwi/contracts";
import { ResearcherProvider, runResearcherProviderWithRetries } from "@kiwi/adapters";
import { resolveRunArtifactPath, writeJsonSafely } from "@kiwi/core";
import { artifact } from "./step-attempt-artifacts";
import type { StepAttemptRunner, StepRunnerExecutionInput, StepRunnerExecutionOutput } from "./step-runner-types";

const RESEARCH_REPORT_REF = "plan/research-report.json";

function readJsonIfObject(target: string): Record<string, unknown> {
  if (!existsSync(target)) return {};
  const parsed = JSON.parse(readFileSync(target, "utf-8")) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function candidateFilesFromContextPackage(contextPackage: unknown): string[] {
  const include =
    typeof contextPackage === "object" && contextPackage !== null && "include" in contextPackage
      ? (contextPackage as { include?: unknown }).include
      : null;
  if (typeof include !== "object" || include === null) return [];
  const record = include as Record<string, unknown>;
  return [
    ...arrayOfStrings(record.relevantFiles),
    ...arrayOfStrings(record.tests),
    ...arrayOfStrings(record.recentDiffFiles),
    ...arrayOfStrings(record.symbolHits),
    ...arrayOfStrings(record.architectureFiles),
  ];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function persistResearchArtifacts(params: {
  cwd: string;
  runId: string;
  report: unknown;
  researcherInput: unknown;
  researcherOutput: unknown;
}): { reportRef: string; inputRef: string; outputRef: string } {
  const reportRef = RESEARCH_REPORT_REF;
  const inputRef = "plan/researcher-input.json";
  const outputRef = "plan/researcher-output.json";
  writeJsonSafely(resolveRunArtifactPath(params.runId, reportRef, params.cwd), params.report);
  writeJsonSafely(resolveRunArtifactPath(params.runId, inputRef, params.cwd), params.researcherInput);
  writeJsonSafely(resolveRunArtifactPath(params.runId, outputRef, params.cwd), params.researcherOutput);

  const plannerInputPath = resolveRunArtifactPath(params.runId, "plan/planner-input.json", params.cwd);
  const plannerInput = readJsonIfObject(plannerInputPath);
  writeJsonSafely(plannerInputPath, {
    ...plannerInput,
    researchReportRef: reportRef,
  });

  return { reportRef, inputRef, outputRef };
}

export class ResearcherStepRunner implements StepAttemptRunner {
  readonly name = RunnerNames.Api;

  constructor(
    private readonly provider: ResearcherProvider,
    private readonly model: ModelEntry,
    private readonly policy: KiwiPolicy,
    private readonly accessMode?: AccessMode,
  ) {}

  async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    const initiative = readJsonIfObject(resolveRunArtifactPath(input.runId, "initiative.json", input.workspacePath));
    const output = await runResearcherProviderWithRetries(this.provider, {
      runId: input.runId,
      stepId: input.stepId,
      initiative: InitiativeSchema.parse(initiative),
      candidateFiles: candidateFilesFromContextPackage(input.contextPackage),
      requestedAt: input.requestedAt ?? new Date().toISOString(),
      policy: this.policy,
    });
    const refs = persistResearchArtifacts({
      cwd: input.workspacePath,
      runId: input.runId,
      report: output.researchReport,
      researcherInput: output.providerArtifacts?.researcherInput ?? {},
      researcherOutput: output.providerArtifacts?.researcherOutput ?? {},
    });
    const createdAt = new Date().toISOString();
    return {
      status: ContractValues.Completed,
      artifactRefs: [
        artifact({ type: "summary", ref: refs.reportRef, createdAt }),
        artifact({ type: "summary", ref: refs.inputRef, createdAt }),
        artifact({ type: "summary", ref: refs.outputRef, createdAt }),
      ].map((entry) => ArtifactSchema.parse(entry)),
      rawLogsRef: refs.outputRef,
      modelUsage: output.modelUsage,
      modelId: this.model.id,
      providerName: output.providerName,
      ...(this.accessMode ? { accessMode: this.accessMode } : {}),
      usagePrecision: "estimated",
      estimatedCostUsd: output.cost.estimatedUsd,
      gateResult: GateResultSchema.parse({
        gateId: "gate_research_report_json",
        gateType: "structured_review_json",
        status: ContractValues.Pass,
        evidenceRefs: [refs.reportRef],
        reason: "ResearchReportSchema validated",
      }),
    };
  }
}
