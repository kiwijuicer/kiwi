import { Artifact, GateResult, GateResultSchema, GateType, GateTypeSchema, KiwiPolicy } from "@kiwi/contracts";
import { executeSandboxCommand, SandboxCommandPolicy } from "@kiwi/sandbox";
import { commandForGate, commandProfileForStep, commandProfileToExecutionPolicy } from "./operator-policy";

function safeGateType(value: string): GateType | null {
  const parsed = GateTypeSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

export async function runRequiredGates(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  worktreePath: string;
  policy: KiwiPolicy;
  requiredGates: string[];
  approved: boolean;
  diffHash?: string | null;
  now?: Date;
}): Promise<{ gateResults: GateResult[]; artifacts: Artifact[] }> {
  const profile = commandProfileForStep(params.policy, "validation");
  const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
  const gateResults: GateResult[] = [];
  const artifacts: Artifact[] = [];

  for (const gate of params.requiredGates) {
    const gateType = safeGateType(gate);

    if (!gateType) {
      continue;
    }
    if (gateType === "forbidden_file_checks" || gateType === "secrets_check") {
      continue;
    }
    const command = commandForGate(params.policy, gateType);

    if (!command) {
      continue;
    }

    const gateInput: Parameters<typeof executeSandboxCommand>[0] = {
      cwd: params.cwd,
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      worktreePath: params.worktreePath,
      command,
      policy: commandPolicy,
      approved: params.approved,
      gateId: `gate_${gateType}`,
      gateType,
      artifactLabel: gateType,
    };

    if (params.now) {
      gateInput.now = params.now;
    }
    const output = await executeSandboxCommand(gateInput);
    gateResults.push(
      params.diffHash
        ? GateResultSchema.parse({
            ...output.gateResult,
            reason: `${output.gateResult.reason} (diffHash: ${params.diffHash})`,
            subject: { type: "diff", hash: params.diffHash },
          })
        : output.gateResult,
    );
    artifacts.push(...output.artifactRefs);
  }

  return { gateResults, artifacts };
}
