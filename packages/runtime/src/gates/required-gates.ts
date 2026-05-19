import {
  Artifact,
  GateResult,
  GateResultSchema,
  GateStatuses,
  GateType,
  GateTypes,
  GateTypeSchema,
  KiwiPolicy,
  StepTypes,
} from "@kiwi/contracts";
import { executeSandboxCommand, SandboxCommandPolicy } from "@kiwi/sandbox";
import { commandForGate, commandProfileForStep, commandProfileToExecutionPolicy } from "../policies/operator-policy.js";

function safeGateType(value: string): GateType | null {
  const parsed = GateTypeSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

const GATES_WITH_EXTERNAL_EVIDENCE = new Set<GateType>([
  GateTypes.CommandPolicy,
  GateTypes.DiffRequired,
  GateTypes.ForbiddenFileChecks,
  GateTypes.SecretsCheck,
]);

function safeGateId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function blockedGate(params: {
  gateId: string;
  gateType: GateType;
  reason: string;
  diffHash?: string | null;
}): GateResult {
  return GateResultSchema.parse({
    gateId: params.gateId,
    gateType: params.gateType,
    status: GateStatuses.Blocked,
    evidenceRefs: [],
    reason: params.diffHash ? `${params.reason} (diffHash: ${params.diffHash})` : params.reason,
    ...(params.diffHash ? { subject: { type: "diff", hash: params.diffHash } } : {}),
  });
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
  const profile = commandProfileForStep(params.policy, StepTypes.Validation);
  const commandPolicy = commandProfileToExecutionPolicy(profile) as SandboxCommandPolicy;
  const gateResults: GateResult[] = [];
  const artifacts: Artifact[] = [];

  for (const gate of params.requiredGates) {
    const gateType = safeGateType(gate);

    if (!gateType) {
      gateResults.push(
        blockedGate({
          gateId: `gate_unknown_${safeGateId(gate)}`,
          gateType: GateTypes.CommandPolicy,
          reason: `Required gate '${gate}' is not a known gate type`,
          ...(params.diffHash !== undefined ? { diffHash: params.diffHash } : {}),
        }),
      );
      continue;
    }
    if (GATES_WITH_EXTERNAL_EVIDENCE.has(gateType)) {
      continue;
    }
    const command = commandForGate(params.policy, gateType);

    if (!command) {
      gateResults.push(
        blockedGate({
          gateId: `gate_${gateType}`,
          gateType,
          reason: `Required gate '${gateType}' has no executable command configured`,
          ...(params.diffHash !== undefined ? { diffHash: params.diffHash } : {}),
        }),
      );
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
