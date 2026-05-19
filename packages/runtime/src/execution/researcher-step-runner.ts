import { existsSync, readFileSync } from "fs";
import {
  AccessMode,
  AccessModes,
  ArtifactSchema,
  ContractValues,
  GateResultSchema,
  InitiativeSchema,
  KiwiPolicy,
  ModelEntry,
  RunnerNames,
} from "@kiwi/contracts";
import {
  ResearcherProvider,
  ResearcherProviderInput,
  ResearcherProviderOutput,
  runResearcherProviderWithRetries,
  StubResearcherProvider,
} from "@kiwi/adapters";
import { resolveRunArtifactPath, writeJsonSafely } from "@kiwi/core";
import { artifact } from "./step-attempt-artifacts.js";
import type { StepAttemptRunner, StepRunnerExecutionInput, StepRunnerExecutionOutput } from "./step-runner-types.js";

const RESEARCH_REPORT_REF = "plan/research-report.json";

function readJsonIfObject(target: string): Record<string, unknown> {
  if (!existsSync(target)) {
    return {};
  }
  const parsed = JSON.parse(readFileSync(target, "utf-8")) as unknown;

  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function candidateFilesFromContextPackage(contextPackage: unknown): string[] {
  const include =
    typeof contextPackage === "object" && contextPackage !== null && "include" in contextPackage
      ? (contextPackage as { include?: unknown }).include
      : null;

  if (typeof include !== "object" || include === null) {
    return [];
  }
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

function buildResearcherInput(params: {
  input: StepRunnerExecutionInput;
  policy: KiwiPolicy;
}): ResearcherProviderInput {
  const initiative = readJsonIfObject(
    resolveRunArtifactPath(params.input.runId, "initiative.json", params.input.workspacePath),
  );

  return {
    runId: params.input.runId,
    stepId: params.input.stepId,
    initiative: InitiativeSchema.parse(initiative),
    candidateFiles: candidateFilesFromContextPackage(params.input.contextPackage),
    requestedAt: params.input.requestedAt ?? new Date().toISOString(),
    policy: params.policy,
  };
}

function runnerOutputFromResearch(params: {
  input: StepRunnerExecutionInput;
  output: ResearcherProviderOutput;
  modelId: string | null;
  accessMode?: AccessMode;
}): StepRunnerExecutionOutput {
  const refs = persistResearchArtifacts({
    cwd: params.input.workspacePath,
    runId: params.input.runId,
    report: params.output.researchReport,
    researcherInput: params.output.providerArtifacts?.researcherInput ?? {},
    researcherOutput: params.output.providerArtifacts?.researcherOutput ?? {},
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
    modelUsage: params.output.modelUsage,
    modelId: params.modelId,
    providerName: params.output.providerName,
    ...(params.accessMode ? { accessMode: params.accessMode } : {}),
    usagePrecision: "estimated",
    estimatedCostUsd: params.output.cost.estimatedUsd,
    gateResult: GateResultSchema.parse({
      gateId: "gate_research_report_json",
      gateType: "structured_review_json",
      status: ContractValues.Pass,
      evidenceRefs: [refs.reportRef],
      reason: "ResearchReportSchema validated",
    }),
  };
}

export class LocalResearchStepRunner implements StepAttemptRunner {
  readonly name = RunnerNames.Api;
  private readonly provider = new StubResearcherProvider();

  constructor(private readonly policy: KiwiPolicy) {}

  async execute(input: StepRunnerExecutionInput): Promise<StepRunnerExecutionOutput> {
    const output = await this.provider.research(buildResearcherInput({ input, policy: this.policy }));
    const researcherOutput =
      typeof output.providerArtifacts?.researcherOutput === "object" &&
      output.providerArtifacts.researcherOutput !== null
        ? output.providerArtifacts.researcherOutput
        : {};

    return runnerOutputFromResearch({
      input,
      output: {
        ...output,
        providerName: "local-research",
        providerArtifacts: {
          researcherInput: output.providerArtifacts?.researcherInput ?? {},
          researcherOutput: { ...researcherOutput, mode: "local-first" },
        },
      },
      modelId: "local-researcher",
      accessMode: AccessModes.Local,
    });
  }
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
    const output = await runResearcherProviderWithRetries(
      this.provider,
      buildResearcherInput({ input, policy: this.policy }),
    );

    return runnerOutputFromResearch({
      input,
      output,
      modelId: this.model.id,
      ...(this.accessMode ? { accessMode: this.accessMode } : {}),
    });
  }
}
