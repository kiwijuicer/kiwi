import { existsSync } from "fs";
import {
  buildDeterministicTaskGraph,
  createInitiativeFromInput,
  generateRunId,
  kiwiPolicyPath,
  loadInitiative,
  loadPolicy,
  savePlannedRun,
} from "@kiwi/core";
import { InitiativeSchema, ProtocolEnvelopeSchema } from "@kiwi/contracts";
import { appendA2AAudit, inboxRef, readJson, resolveA2APath, writeJsonSafely } from "./common";
import { ensureA2AStorage } from "./config";
import type { A2AAcceptHandoffInput, A2AAcceptHandoffResult } from "./types";

export function acceptA2AHandoff(input: A2AAcceptHandoffInput): A2AAcceptHandoffResult {
  ensureA2AStorage(input.cwd);
  const ref = inboxRef(input.messageId);
  const target = resolveA2APath(input.cwd, ref);
  if (!existsSync(target)) {
    throw new Error(`A2A inbox message not found: ${input.messageId}`);
  }
  const record = readJson(target) as {
    envelope?: unknown;
    acceptedPayload?: unknown;
    decision?: unknown;
    materializedRunId?: unknown;
  };
  const envelope = ProtocolEnvelopeSchema.parse(record.envelope);
  if (envelope.kind !== "initiative") {
    throw new Error(`A2A message is not an initiative handoff: ${input.messageId}`);
  }
  if (typeof record.materializedRunId === "string") {
    return {
      runId: record.materializedRunId,
      initiative: loadInitiative(record.materializedRunId, input.cwd),
      messageId: input.messageId,
    };
  }

  const remoteInitiative = InitiativeSchema.parse(record.acceptedPayload);
  const now = input.now ?? new Date();
  const runId = generateRunId(now);
  const policy = loadPolicy(kiwiPolicyPath(input.cwd));
  const initiative = createInitiativeFromInput({
    rawInput: remoteInitiative.rawInput,
    repoPath: input.repoPath,
    source: "a2a",
    riskProfile: remoteInitiative.riskProfile,
    budgetProfile: remoteInitiative.budgetProfile,
    now,
  });
  const taskGraph = buildDeterministicTaskGraph({
    runId,
    initiative,
    policy,
    now,
  });
  const saveParams: Parameters<typeof savePlannedRun>[0] = {
    runId,
    initiative,
    taskGraph,
    plannerInput: {
      source: "a2a",
      messageId: input.messageId,
      remoteInitiative,
    },
    plannerOutput: {
      providerName: "a2a-filesystem",
      taskGraph,
    },
    cwd: input.cwd,
    workspacePath: input.workspacePath ?? input.cwd,
    repoPath: input.repoPath,
    now,
  };
  if (input.repoId) saveParams.repoId = input.repoId;
  savePlannedRun(saveParams);
  const updated = {
    ...record,
    materializedRunId: runId,
    materializedAt: now.toISOString(),
  };
  writeJsonSafely(target, updated);
  appendA2AAudit({
    cwd: input.cwd,
    eventType: "a2a_initiative_materialized",
    timestamp: now.toISOString(),
    runId,
    payload: {
      messageId: input.messageId,
      sourceAgentId: envelope.a2a?.senderAgentId ?? null,
    },
  });
  return { runId, initiative, messageId: input.messageId };
}
