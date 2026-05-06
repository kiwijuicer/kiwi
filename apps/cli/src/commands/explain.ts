import { buildRunExplanation } from "@kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

interface ExplainOptions extends CliWorkspaceOptions {
  json?: boolean;
  now?: Date;
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
  if (explanation.routing.length > 0) {
    console.log("routing:");
    for (const decision of explanation.routing) {
      console.log(
        `  ${decision.stepId}/${decision.attemptId} ${decision.status} capability:${decision.selectedCapability ?? "unknown"} runner:${decision.runner ?? "none"} reasons:${decision.routingReason.join(",") || "none"}`,
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
