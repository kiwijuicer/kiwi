import { mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { AgentRoles, type TaskGraph } from "@kiwi/contracts";
import { appendAuditEvent, AuditEventTypes, ensureRunLayout, resolveRunArtifactPath } from "@kiwi/core";

export interface PlanMarkdownStep {
  stepId: string;
  title: string;
  type: string;
  agentRole: string;
  modelCapability: string;
  modelId: string | null;
  providerModel: string | null;
  estimatedCostUsd: number;
}

export interface PlanMarkdownResult {
  runId: string;
  ref: string;
  path: string;
  uri: string;
  generatedAt: string;
}

export interface WritePlanMarkdownInput {
  cwd: string;
  runId: string;
  taskGraph: TaskGraph;
  plannerModelId: string;
  providerName: string;
  providerModel?: string | null | undefined;
  estimatedCostUsd: number;
  steps: PlanMarkdownStep[];
  now?: Date | undefined;
}

const PLAN_MARKDOWN_REF = "plan.md";

function writeTextSafely(target: string, value: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, value, "utf-8");
  renameSync(tempPath, target);
}

function tableCell(value: string | number | null | undefined): string {
  return String(value ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function list(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function modelLabel(modelId: string | null, providerModel: string | null, capability: string): string {
  const resolvedModel = providerModel ?? modelId ?? capability;

  return modelId && providerModel && modelId !== providerModel ? `${providerModel} (${modelId})` : resolvedModel;
}

export function renderPlanMarkdownArtifact(input: WritePlanMarkdownInput): string {
  const plannerModel = modelLabel(input.plannerModelId, input.providerModel ?? null, AgentRoles.Planner);
  const stepRows = input.steps
    .map((step, index) =>
      [
        index + 1,
        step.stepId,
        step.title,
        step.type,
        step.agentRole,
        modelLabel(step.modelId, step.providerModel, step.modelCapability),
        `$${step.estimatedCostUsd.toFixed(4)}`,
      ]
        .map(tableCell)
        .join(" | "),
    )
    .map((row) => `| ${row} |`)
    .join("\n");

  return [
    `# Kiwi Plan ${input.runId}`,
    "",
    `Plan: \`${input.taskGraph.planId}\``,
    `Planner model: **${plannerModel} via ${input.providerName}**`,
    `Estimated cost: **$${input.estimatedCostUsd.toFixed(4)}**`,
    "",
    "## Summary",
    "",
    input.taskGraph.summary,
    "",
    "## Steps",
    "",
    "| # | Step | Title | Type | Role | Model | Cost |",
    "|---:|---|---|---|---|---|---:|",
    stepRows,
    "",
    "## Acceptance Criteria",
    "",
    list(input.taskGraph.acceptanceCriteria),
    "",
    "## Assumptions",
    "",
    list(input.taskGraph.assumptions),
    "",
    "## Open Questions",
    "",
    list(input.taskGraph.openQuestions),
    "",
  ].join("\n");
}

export function writePlanMarkdown(input: WritePlanMarkdownInput): PlanMarkdownResult {
  ensureRunLayout(input.runId, input.cwd);
  const generatedAt = (input.now ?? new Date()).toISOString();
  const target = resolveRunArtifactPath(input.runId, PLAN_MARKDOWN_REF, input.cwd);
  const markdown = renderPlanMarkdownArtifact(input);

  writeTextSafely(target, markdown);
  appendAuditEvent(input.cwd, {
    eventType: AuditEventTypes.PlanMarkdownWritten,
    runId: input.runId,
    timestamp: generatedAt,
    payload: { ref: PLAN_MARKDOWN_REF },
  });

  return {
    runId: input.runId,
    ref: PLAN_MARKDOWN_REF,
    path: target,
    uri: pathToFileURL(target).href,
    generatedAt,
  };
}
