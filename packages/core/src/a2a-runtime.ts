import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";
import {
  A2ARuntimeDecision,
  A2ARuntimeDecisionSchema,
  A2ARuntimeMode,
  ArtifactSchema,
  GateResultSchema,
  InitiativeSchema,
  ProtocolEnvelope,
  ProtocolEnvelopeKind,
  ProtocolEnvelopeSchema,
  ReviewVerdictSchema,
  StepAttemptSchema,
  TaskGraphSchema,
} from "@ai-kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";

export interface A2ARuntimePolicy {
  mode: A2ARuntimeMode;
  localAgentId: string;
  trustedAgentIds: string[];
  acceptedKinds: ProtocolEnvelopeKind[];
}

export interface HandleA2AEnvelopeInput {
  cwd: string;
  envelope: unknown;
  policy?: Partial<A2ARuntimePolicy>;
  now?: Date | undefined;
}

export interface HandleA2AEnvelopeResult {
  decision: A2ARuntimeDecision;
  envelope?: ProtocolEnvelope;
}

const DEFAULT_POLICY: A2ARuntimePolicy = {
  mode: "disabled",
  localAgentId: "ai-kiwi-local",
  trustedAgentIds: [],
  acceptedKinds: ["task_graph", "step_attempt", "gate_result", "review_verdict", "artifact"],
};

function effectivePolicy(policy: Partial<A2ARuntimePolicy> | undefined): A2ARuntimePolicy {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    trustedAgentIds: policy?.trustedAgentIds ?? DEFAULT_POLICY.trustedAgentIds,
    acceptedKinds: policy?.acceptedKinds ?? DEFAULT_POLICY.acceptedKinds,
  };
}

function a2aRoot(cwd: string): string {
  return path.join(cwd, ".kiwi", "a2a");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

function idempotencyRef(idempotencyKey: string): string {
  return `idempotency/${safeFileName(idempotencyKey)}.json`;
}

function inboxRef(messageId: string): string {
  return `inbox/${safeFileName(messageId)}.json`;
}

function resolveA2APath(cwd: string, ref: string): string {
  const base = path.resolve(a2aRoot(cwd));
  const target = path.resolve(base, ref);
  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`A2A path escapes storage root: ${ref}`);
  }
  return target;
}

function runIdFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as { runId?: unknown }).runId;
  return typeof value === "string" && /^run_[a-z0-9_]+$/.test(value) ? value : undefined;
}

function decision(params: {
  status: A2ARuntimeDecision["status"];
  reason: string;
  createdAt: string;
  envelope?: ProtocolEnvelope | undefined;
  runId?: string | undefined;
  inboxRef?: string | undefined;
  duplicateOfRef?: string | undefined;
}): A2ARuntimeDecision {
  const value: A2ARuntimeDecision = {
    schemaVersion: "1",
    status: params.status,
    reason: params.reason,
    createdAt: params.createdAt,
  };
  if (params.envelope?.a2a?.messageId) value.messageId = params.envelope.a2a.messageId;
  if (params.envelope?.a2a?.correlationId) value.correlationId = params.envelope.a2a.correlationId;
  if (params.runId) value.runId = params.runId;
  if (params.inboxRef) value.inboxRef = params.inboxRef;
  if (params.duplicateOfRef) value.duplicateOfRef = params.duplicateOfRef;
  return A2ARuntimeDecisionSchema.parse(value);
}

function appendA2AAudit(params: {
  cwd: string;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
  runId?: string;
}): void {
  const target = resolveA2APath(params.cwd, "audit.log");
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(
    target,
    `${JSON.stringify({
      eventType: params.eventType,
      runId: params.runId ?? null,
      timestamp: params.timestamp,
      payload: params.payload,
    })}\n`,
    "utf-8",
  );
  if (params.runId) {
    appendAuditEvent(params.cwd, {
      eventType: "a2a_runtime_event",
      runId: params.runId,
      timestamp: params.timestamp,
      payload: {
        eventType: params.eventType,
        ...params.payload,
      },
    });
  }
}

function validatePayload(envelope: ProtocolEnvelope): unknown {
  switch (envelope.kind) {
    case "initiative":
      return InitiativeSchema.parse(envelope.payload);
    case "task_graph":
      return TaskGraphSchema.parse(envelope.payload);
    case "step_attempt":
      return StepAttemptSchema.parse(envelope.payload);
    case "gate_result":
      return GateResultSchema.parse(envelope.payload);
    case "review_verdict":
      return ReviewVerdictSchema.parse(envelope.payload);
    case "artifact":
      return ArtifactSchema.parse(envelope.payload);
  }
}

function isRemotePatch(envelope: ProtocolEnvelope): boolean {
  if (envelope.kind !== "artifact") return false;
  const artifact = ArtifactSchema.parse(envelope.payload);
  return artifact.type === "diff" || artifact.type === "patch";
}

function duplicateDecision(params: {
  cwd: string;
  envelope: ProtocolEnvelope;
  createdAt: string;
}): A2ARuntimeDecision | null {
  const metadata = params.envelope.a2a;
  if (!metadata) return null;
  const ref = idempotencyRef(metadata.idempotencyKey);
  const target = resolveA2APath(params.cwd, ref);
  if (!existsSync(target)) return null;
  const stored = readJson(target) as { decision?: unknown };
  const existing = A2ARuntimeDecisionSchema.parse(stored.decision);
  return decision({
    status: "duplicate",
    reason: "A2A idempotency key has already been handled",
    envelope: params.envelope,
    runId: existing.runId,
    duplicateOfRef: ref,
    createdAt: params.createdAt,
  });
}

function persistAcceptedEnvelope(params: {
  cwd: string;
  envelope: ProtocolEnvelope;
  acceptedPayload: unknown;
  decision: A2ARuntimeDecision;
  envelopeRef: string;
}): void {
  const metadata = params.envelope.a2a;
  if (!metadata) throw new Error("A2A metadata is required");
  writeJsonSafely(resolveA2APath(params.cwd, params.envelopeRef), {
    envelope: params.envelope,
    acceptedPayload: params.acceptedPayload,
    decision: params.decision,
  });
  writeJsonSafely(resolveA2APath(params.cwd, idempotencyRef(metadata.idempotencyKey)), {
    idempotencyKey: metadata.idempotencyKey,
    envelopeRef: params.envelopeRef,
    decision: params.decision,
  });
}

export function handleA2AEnvelope(input: HandleA2AEnvelopeInput): HandleA2AEnvelopeResult {
  const createdAt = (input.now ?? new Date()).toISOString();
  const envelope = ProtocolEnvelopeSchema.parse(input.envelope);
  const policy = effectivePolicy(input.policy);

  if (policy.mode === "disabled") {
    const blocked = decision({
      status: "blocked",
      reason: "A2A runtime is disabled by policy",
      envelope,
      createdAt,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_blocked",
      timestamp: createdAt,
      payload: { reason: blocked.reason, kind: envelope.kind },
    });
    return { decision: blocked, envelope };
  }

  if (!envelope.a2a) {
    const blocked = decision({
      status: "blocked",
      reason: "A2A metadata is required for runtime handling",
      envelope,
      createdAt,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_blocked",
      timestamp: createdAt,
      payload: { reason: blocked.reason, kind: envelope.kind },
    });
    return { decision: blocked, envelope };
  }

  const duplicate = duplicateDecision({ cwd: input.cwd, envelope, createdAt });
  if (duplicate) {
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_duplicate",
      timestamp: createdAt,
      payload: {
        messageId: envelope.a2a.messageId,
        duplicateOfRef: duplicate.duplicateOfRef,
      },
      ...(duplicate.runId ? { runId: duplicate.runId } : {}),
    });
    return { decision: duplicate, envelope };
  }

  const runId = runIdFromPayload(envelope.payload);
  if (envelope.a2a.recipientAgentId !== policy.localAgentId) {
    const blocked = decision({
      status: "blocked",
      reason: "A2A recipient does not match local agent identity",
      envelope,
      runId,
      createdAt,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_blocked",
      timestamp: createdAt,
      payload: { reason: blocked.reason, messageId: envelope.a2a.messageId },
      ...(runId ? { runId } : {}),
    });
    return { decision: blocked, envelope };
  }

  if (!policy.trustedAgentIds.includes(envelope.a2a.senderAgentId)) {
    const blocked = decision({
      status: "blocked",
      reason: "A2A sender is not trusted",
      envelope,
      runId,
      createdAt,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_blocked",
      timestamp: createdAt,
      payload: {
        reason: blocked.reason,
        senderAgentId: envelope.a2a.senderAgentId,
      },
      ...(runId ? { runId } : {}),
    });
    return { decision: blocked, envelope };
  }

  if (!policy.acceptedKinds.includes(envelope.kind)) {
    const blocked = decision({
      status: "blocked",
      reason: "A2A envelope kind is not accepted by policy",
      envelope,
      runId,
      createdAt,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_blocked",
      timestamp: createdAt,
      payload: { reason: blocked.reason, kind: envelope.kind },
      ...(runId ? { runId } : {}),
    });
    return { decision: blocked, envelope };
  }

  const acceptedPayload = validatePayload(envelope);
  if (isRemotePatch(envelope)) {
    const blocked = decision({
      status: "blocked",
      reason: "Remote patch artifacts require local apply gates and are not accepted yet",
      envelope,
      runId,
      createdAt,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_blocked",
      timestamp: createdAt,
      payload: { reason: blocked.reason, kind: envelope.kind },
      ...(runId ? { runId } : {}),
    });
    return { decision: blocked, envelope };
  }

  const ref = inboxRef(envelope.a2a.messageId);
  const accepted = decision({
    status: "accepted",
    reason: "A2A envelope accepted into local loopback inbox",
    envelope,
    runId,
    inboxRef: ref,
    createdAt,
  });
  persistAcceptedEnvelope({
    cwd: input.cwd,
    envelope,
    acceptedPayload,
    decision: accepted,
    envelopeRef: ref,
  });
  appendA2AAudit({
    cwd: input.cwd,
    eventType: "a2a_envelope_accepted",
    timestamp: createdAt,
    payload: {
      messageId: envelope.a2a.messageId,
      kind: envelope.kind,
      inboxRef: ref,
    },
    ...(runId ? { runId } : {}),
  });

  return { decision: accepted, envelope };
}
