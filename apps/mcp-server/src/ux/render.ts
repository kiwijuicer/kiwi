import { ContractValues, ProgressStatuses, StepStatuses } from "@kiwi/contracts";
import { ActivityTimelineChildModes, renderActivityTimelineMarkdown, type RunActivityTimeline } from "@kiwi/ops";

interface PlanStepRenderInput {
  stepId: string;
  title: string;
  type: string;
  agentRole?: string | null | undefined;
  modelCapability?: string | null | undefined;
  modelId?: string | null | undefined;
  providerModel?: string | null | undefined;
  estimatedCostUsd?: number | null | undefined;
}

interface PlanRenderInput {
  runId: string;
  planId: string;
  workspacePath: string;
  plannerModelId: string;
  providerName: string;
  providerModel?: string | null | undefined;
  stepCount: number;
  summary: string;
  acceptanceCriteria: string[];
  assumptions?: string[] | undefined;
  openQuestions?: string[] | undefined;
  estimatedCostUsd: number;
  planMarkdownPath?: string | undefined;
  planMarkdownUri?: string | undefined;
  steps?: PlanStepRenderInput[] | undefined;
}

interface DiffStepRenderInput {
  stepId: string;
  attemptId: string;
  stat: string;
  patch: string;
  reviewVerdict: string;
}

interface DiffRenderInput {
  runId: string;
  items: DiffStepRenderInput[];
  stat: string;
}

interface StepProgressRenderInput {
  phase: string;
  status: string;
  stepId: string;
  attemptId?: string | null | undefined;
  modelId?: string | null | undefined;
  providerModel?: string | null | undefined;
  capability?: string | null | undefined;
  runner?: string | null | undefined;
  stepIndex?: number | undefined;
  stepCount?: number | undefined;
  reason?: string | null | undefined;
  verdict?: string | null | undefined;
  safeToContinue?: boolean | null | undefined;
  gate?: string | null | undefined;
  runStatus?: string | null | undefined;
  error?: string | null | undefined;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function bulletList(items: string[]): string[] {
  return items.length === 0 ? ["- none"] : items.map((item) => `- ${item}`);
}

function modelLabel(params: {
  modelId?: string | null | undefined;
  providerModel?: string | null | undefined;
  capability?: string | null | undefined;
  runner?: string | null | undefined;
  providerName?: string | null | undefined;
}): string {
  const model = params.providerModel ?? params.modelId ?? params.capability ?? "model unknown";
  const via = params.providerName ?? params.runner;

  return via ? `${model} via ${via}` : model;
}

function tableCell(value: string | number | null | undefined): string {
  return String(value ?? "-")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function operatorHeader(value: JsonRecord): string | null {
  const operatorCard = record(value.operatorCard);
  const runId = stringValue(operatorCard.runId, stringValue(value.runId));

  if (!runId) {
    return null;
  }
  const planner = record(value.planner);
  const plannerModel = modelLabel({
    modelId: stringValue(planner.modelId) || undefined,
    providerModel: stringValue(planner.providerModel) || undefined,
    providerName: stringValue(planner.providerName) || undefined,
  });

  return renderOperatorStatusLine({
    runId,
    currentState: stringValue(operatorCard.currentState, stringValue(value.status, "unknown")),
    plannerModel: plannerModel === "model unknown" ? null : plannerModel,
  });
}

function nextActionLines(value: JsonRecord): string[] {
  const nextAction = record(value.nextAction ?? record(value.operatorCard).nextAction);
  const tool = record(nextAction.recommendedToolCall);
  const name = stringValue(tool.name);

  if (!name) {
    return [];
  }

  return [
    "",
    `Next: \`${name}\``,
    stringValue(nextAction.whyThisTool) ? stringValue(nextAction.whyThisTool) : "",
  ].filter((line) => line !== "");
}

function resourceLines(value: JsonRecord): string[] {
  const resources = record(value.operatorCard).resources;

  if (!Array.isArray(resources) || resources.length === 0) {
    return [];
  }

  return [
    "",
    "Resources:",
    ...resources.map((resource) => {
      const item = record(resource);

      return `- ${stringValue(item.name, "resource")}: \`${stringValue(item.uri)}\``;
    }),
  ];
}

function renderWithHeader(value: JsonRecord, body: string): string {
  const lines = [operatorHeader(value), body, ...nextActionLines(value), ...resourceLines(value)].filter(
    (line): line is string => typeof line === "string" && line.length > 0,
  );

  return lines.join("\n\n");
}

function renderPlanMarkdown(input: PlanRenderInput): string {
  const planUri = input.planMarkdownUri ?? input.planMarkdownPath;
  const planLine =
    input.planMarkdownPath && planUri
      ? `Plan file: [\`${input.planMarkdownPath}\`](${planUri})`
      : "Plan file: not written";
  const stepLines =
    input.steps && input.steps.length > 0
      ? [
          "",
          "| # | Step | Title | Type | Model | Cost |",
          "|---:|---|---|---|---|---:|",
          ...input.steps
            .map((step, index) =>
              [
                index + 1,
                step.stepId,
                step.title,
                step.type,
                modelLabel({
                  modelId: step.modelId,
                  providerModel: step.providerModel,
                  capability: step.modelCapability,
                  runner: step.agentRole,
                }),
                step.estimatedCostUsd === null || step.estimatedCostUsd === undefined
                  ? "-"
                  : `$${step.estimatedCostUsd.toFixed(4)}`,
              ]
                .map(tableCell)
                .join(" | "),
            )
            .map((row) => `| ${row} |`),
        ]
      : [];

  return [
    `## Plan ${input.runId}`,
    "",
    input.summary,
    "",
    `Model: **${modelLabel({
      modelId: input.plannerModelId,
      providerModel: input.providerModel,
      providerName: input.providerName,
    })}**`,
    `Steps: **${input.stepCount}**`,
    `Estimated cost: **$${input.estimatedCostUsd.toFixed(4)}**`,
    planLine,
    ...stepLines,
    "",
    "Acceptance criteria:",
    ...bulletList(input.acceptanceCriteria),
    "",
    "Open questions:",
    ...bulletList(input.openQuestions ?? []),
  ].join("\n");
}

function renderDiffMarkdown(input: DiffRenderInput): string {
  if (input.items.length === 0) {
    return `## Diff ${input.runId}\n\nNo diff items.`;
  }
  const sections = input.items.flatMap((item) => [
    `### ${item.stepId} - ${item.reviewVerdict}`,
    "",
    item.stat ? `Stat:\n\`\`\`text\n${item.stat}\n\`\`\`` : "",
    "",
    `\`\`\`diff\n${item.patch}\n\`\`\``,
  ]);

  return [`## Diff ${input.runId}`, "", input.stat ? `\`\`\`text\n${input.stat}\n\`\`\`` : "", "", ...sections].join(
    "\n",
  );
}

export function renderStepProgressLine(input: StepProgressRenderInput): string {
  const prefix =
    input.stepIndex !== undefined && input.stepCount !== undefined ? `[${input.stepIndex}/${input.stepCount}] ` : "";
  const model = modelLabel({
    modelId: input.modelId,
    providerModel: input.providerModel,
    capability: input.capability,
    runner: input.runner,
  });
  const suffix = input.reason ? ` (${input.reason})` : "";

  if (input.phase === "routing" && input.status === "selected") {
    return `${prefix}Routing ${input.stepId}: ${model}${suffix}`;
  }
  if (input.phase === "step" && input.status === "started") {
    return `${prefix}Running ${input.stepId}`;
  }
  if (input.phase === "gate" && input.status === ProgressStatuses.Running) {
    return `${prefix}Checking gates for ${input.stepId}`;
  }
  if (input.phase === "gate") {
    return `${prefix}Gate ${input.gate ?? "gate"} ${input.status} for ${input.stepId}${suffix}`;
  }
  if (input.phase === "review") {
    const verdict = input.verdict ?? input.status;

    return `${prefix}Review ${verdict} for ${input.stepId}`;
  }
  if (input.phase === "step" && input.status === ProgressStatuses.Failed) {
    return `${prefix}Failed ${input.stepId}: ${input.error ?? "unknown error"}`;
  }
  if (input.phase === "step") {
    return `${prefix}${input.status} ${input.stepId}`;
  }

  return `${prefix}${input.phase} ${input.status} ${input.stepId}`;
}

function renderOperatorStatusLine(params: {
  runId: string;
  currentState: string;
  plannerModel?: string | null | undefined;
}): string {
  const parts = [`Run ${params.runId}`, params.currentState];

  if (params.plannerModel) {
    parts.push(`model: ${params.plannerModel}`);
  }

  return parts.join(" - ");
}

class McpToolResultRenderer {
  constructor(private readonly value: JsonRecord) {}

  render(): string {
    switch (stringValue(this.value.kind)) {
      case "planned_run":
        return this.renderPlannedRun();
      case "run_execution_preview":
        return this.renderPreview();
      case "run_diff":
        return this.renderRunDiff();
      case "run_status":
        return this.renderStatus();
      case "run_execution_result":
        return this.renderExecutionResult();
      default:
        return this.renderSimple();
    }
  }

  private renderPlannedRun(): string {
    const workspace = record(this.value.workspace);
    const taskGraph = record(this.value.taskGraph);
    const planner = record(this.value.planner);
    const cost = record(this.value.cost);
    const artifacts = record(this.value.artifacts);
    const planMarkdown = record(artifacts.planMarkdown);
    const forecast = record(cost.forecast);
    const forecastSteps = Array.isArray(forecast.steps) ? forecast.steps : [];

    return renderWithHeader(
      this.value,
      renderPlanMarkdown({
        runId: stringValue(this.value.runId),
        planId: stringValue(this.value.planId),
        workspacePath: stringValue(workspace.workspacePath),
        plannerModelId: stringValue(planner.modelId, "unknown"),
        providerName: stringValue(planner.providerName, "unknown"),
        providerModel: stringValue(planner.providerModel) || undefined,
        stepCount: numberValue(taskGraph.stepCount),
        summary: stringValue(taskGraph.summary),
        acceptanceCriteria: stringArray(taskGraph.acceptanceCriteria),
        assumptions: stringArray(taskGraph.assumptions),
        openQuestions: stringArray(taskGraph.openQuestions),
        estimatedCostUsd: numberValue(cost.estimatedCostUsd),
        planMarkdownPath: stringValue(planMarkdown.path) || undefined,
        planMarkdownUri: stringValue(planMarkdown.uri) || undefined,
        steps: forecastSteps.map((step): PlanStepRenderInput => {
          const item = record(step);

          return {
            stepId: stringValue(item.stepId),
            title: stringValue(item.title),
            type: "-",
            modelId: stringValue(item.executorModelId) || undefined,
            estimatedCostUsd: numberValue(item.totalCostUsd),
          };
        }),
      }),
    );
  }

  private renderPreview(): string {
    const cost = record(this.value.cost);
    const execution = record(this.value.execution);
    const decision = record(this.value.decision);
    const steps = Array.isArray(this.value.steps) ? this.value.steps.map(record) : [];
    const stepLines = steps.map((step) => {
      const label = modelLabel({
        modelId: stringValue(step.selectedModelId) || undefined,
        providerModel: stringValue(step.selectedProviderModel) || undefined,
        capability: stringValue(step.modelCapability) || undefined,
        runner: stringValue(step.selectedAccessMode) || stringValue(step.runner) || undefined,
      });
      const marker = stringValue(step.status) === ContractValues.Blocked ? "■" : "○";

      return `${marker} ${step.index}/${step.count} ${stringValue(step.stepId)} ${stringValue(step.title)} - ${label}`;
    });

    return renderWithHeader(
      this.value,
      [
        `## Execution Preview ${stringValue(this.value.runId)}`,
        "",
        stringValue(decision.confirmationSummary),
        "",
        `Mode: **${stringValue(execution.isolation, "unknown")}**`,
        `Estimated cost: **$${numberValue(cost.estimatedCostUsd).toFixed(4)}**`,
        "",
        "Activity:",
        ...stepLines,
      ].join("\n"),
    );
  }

  private activityTimeline(): RunActivityTimeline | null {
    const timeline = record(this.value.activityTimeline);

    if (stringValue(timeline.schemaVersion) !== "1" || !Array.isArray(timeline.activities)) {
      return null;
    }

    return timeline as unknown as RunActivityTimeline;
  }

  private renderRunDiff(): string {
    const diff = record(this.value.diff);
    const items = Array.isArray(diff.items) ? diff.items.map(record) : [];

    return renderWithHeader(
      this.value,
      renderDiffMarkdown({
        runId: stringValue(diff.runId, stringValue(this.value.runId)),
        stat: stringValue(diff.stat),
        items: items.map(
          (item): DiffStepRenderInput => ({
            stepId: stringValue(item.stepId),
            attemptId: stringValue(item.attemptId),
            stat: stringValue(item.stat),
            patch: stringValue(item.patch),
            reviewVerdict: stringValue(item.reviewVerdict, "unknown"),
          }),
        ),
      }),
    );
  }

  private renderStatus(): string {
    const timeline = this.activityTimeline();

    if (timeline) {
      return renderWithHeader(
        this.value,
        renderActivityTimelineMarkdown(timeline, { includeChildren: ActivityTimelineChildModes.Focused }),
      );
    }
    const status = record(this.value.status);
    const latest = Array.isArray(status.latest) ? status.latest.map(record) : [];
    const run = latest[0];
    const steps = run && Array.isArray(run.steps) ? run.steps.map(record) : [];

    if (!run) {
      return renderWithHeader(this.value, `## Run Status\n\nNo runs found.`);
    }

    return renderWithHeader(
      this.value,
      [
        `## Run Status ${stringValue(run.runId)}`,
        "",
        `State: **${stringValue(run.currentStatus, stringValue(run.status, "unknown"))}**`,
        `Plan: \`${stringValue(run.currentPlanId)}\``,
        "",
        "Activity:",
        ...steps.map(
          (step) =>
            `○ ${stringValue(step.stepId)} ${stringValue(
              step.status,
              stringValue(step.plannedStatus, StepStatuses.Pending),
            )}: ${stringValue(step.title)}`,
        ),
      ].join("\n"),
    );
  }

  private renderExecutionResult(): string {
    const timeline = this.activityTimeline();

    if (timeline) {
      return renderWithHeader(this.value, renderActivityTimelineMarkdown(timeline));
    }
    const summary = record(this.value.summary);
    const steps = Array.isArray(this.value.steps) ? this.value.steps.map(record) : [];

    return renderWithHeader(
      this.value,
      [
        `## Run ${stringValue(this.value.runId)}`,
        "",
        `Status: **${stringValue(this.value.status)}**`,
        `Cost: **$${numberValue(summary.totalEstimatedCostUsd).toFixed(4)}**`,
        `Next: **${stringValue(summary.nextAction, "unknown")}**`,
        "",
        "Activity:",
        ...steps.map((step) => {
          const fallback = record(step.fallback);
          const fallbackLabel = stringValue(fallback.replacementRunner)
            ? ` - fallback: ${stringValue(fallback.failedRunner)} -> ${stringValue(fallback.replacementRunner)}`
            : "";

          return `- \`${stringValue(step.stepId)}\` ${stringValue(step.status)} (${stringValue(step.attemptId)})${fallbackLabel}`;
        }),
      ].join("\n"),
    );
  }

  private renderSimple(): string {
    const kind = stringValue(this.value.kind, "kiwi_result");
    const runId = stringValue(this.value.runId);
    const status = stringValue(this.value.status);

    return renderWithHeader(
      this.value,
      [`## ${kind}`, runId ? `Run: \`${runId}\`` : "", status ? `Status: **${status}**` : ""]
        .filter((line) => line.length > 0)
        .join("\n\n"),
    );
  }
}

export function renderMcpToolResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return String(value);
  }

  return new McpToolResultRenderer(value).render();
}
