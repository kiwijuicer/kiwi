import { TaskGraph } from "@kiwi/contracts";

export function formatSubPlanTreeLines(taskGraph: TaskGraph, indent: string = ""): string[] {
  if (!taskGraph.subPlans || taskGraph.subPlans.length === 0) return [];

  const lines: string[] = [];
  const stepTitleById = new Map(taskGraph.steps.map((step) => [step.stepId, step.title]));
  const lastSubPlanIndex = taskGraph.subPlans.length - 1;

  for (const [subPlanIndex, subPlan] of taskGraph.subPlans.entries()) {
    const branch = subPlanIndex === lastSubPlanIndex ? "\\-" : "|-";
    const details = [`max=${subPlan.maxConcurrency}`];
    if (subPlan.dependsOn.length > 0) {
      details.push(`dependsOn=${subPlan.dependsOn.join(",")}`);
    }
    lines.push(`${indent}${branch} ${subPlan.subPlanId} [${details.join(" ")}] ${subPlan.title}`);

    const childIndent = `${indent}${subPlanIndex === lastSubPlanIndex ? "   " : "|  "}`;
    const lastStepIndex = subPlan.stepIds.length - 1;
    for (const [stepIndex, stepId] of subPlan.stepIds.entries()) {
      const stepBranch = stepIndex === lastStepIndex ? "\\-" : "|-";
      const title = stepTitleById.get(stepId);
      lines.push(`${childIndent}${stepBranch} ${stepId}${title ? ` ${title}` : ""}`);
    }
  }

  return lines;
}
