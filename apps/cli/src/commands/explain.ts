import { buildRunExplanation } from "@kiwi/ops";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

interface ExplainOptions extends CliWorkspaceOptions {
  json?: boolean;
  now?: Date;
}

function executorReasonFor(decision: unknown): string | null {
  if (typeof decision !== "object" || decision === null || !("executorReason" in decision)) return null;
  const value = (decision as { executorReason?: unknown }).executorReason;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function runExplain(runId: string, opts: ExplainOptions = {}, cwd: string = process.cwd()): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const explanation = buildRunExplanation({
    cwd: workspace.workspacePath,
    runId,
    ...(opts.now ? { now: opts.now } : {}),
  });

  if (opts.json) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }

  console.log(explanation.completionSummary.compact);
  console.log(`next: ${explanation.nextAction}`);
  if (explanation.completionSummary.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of explanation.completionSummary.warnings) {
      console.log(`  ${warning}`);
    }
  }
  const byStep = Object.entries(explanation.completionSummary.byStepCostsUsd);
  if (byStep.length > 0) {
    console.log("cost_by_step:");
    for (const [stepId, costs] of byStep) {
      console.log(`  ${stepId} planner:${costs.planner.toFixed(2)} executor:${costs.executor.toFixed(2)} reviewer:${costs.reviewer.toFixed(2)}`);
    }
  }
  const byModel = Object.entries(explanation.completionSummary.byModelCostsUsd).sort((a, b) => b[1] - a[1]);
  if (byModel.length > 0) {
    console.log("cost_by_model:");
    for (const [modelLabel, costUsd] of byModel) {
      console.log(`  ${modelLabel} ${costUsd.toFixed(2)}`);
    }
  }
  if (explanation.routing.length > 0) {
    console.log("routing:");
    for (const decision of explanation.routing) {
      const executorReason = executorReasonFor(decision);
      const executorSuffix = executorReason ? ` executor:${executorReason}` : "";
      console.log(
        `  ${decision.stepId}/${decision.attemptId} ${decision.status} capability:${decision.selectedCapability ?? "unknown"} runner:${decision.runner ?? "none"}${executorSuffix} reasons:${decision.routingReason.join(",") || "none"}`,
      );
    }
  }
  if (explanation.gates.length > 0) {
    console.log("gates:");
    for (const gate of explanation.gates) {
      console.log(`  ${gate.stepId}/${gate.attemptId} ${gate.gateType}:${gate.status} ${gate.reason}`);
    }
  }
}
