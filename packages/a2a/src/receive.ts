import { ContractValues, ProtocolEnvelopeSchema } from "@kiwi/contracts";
import type { A2AMessageMetadata, ProtocolEnvelope } from "@kiwi/contracts";
import {
  appendA2AAudit,
  decision,
  duplicateDecision,
  effectivePolicy,
  inboxRef,
  isRemotePatch,
  persistAcceptedEnvelope,
  persistQuarantinedEnvelope,
  quarantineRef,
  remotePatchAllowed,
  runIdFromPayload,
  validateAttachments,
  validatePayload,
} from "./common";
import type { A2ARuntimePolicy } from "./common";
import type { HandleA2AEnvelopeInput, HandleA2AEnvelopeResult } from "./types";

interface ReceiveContext {
  input: HandleA2AEnvelopeInput;
  createdAt: string;
  envelope: ProtocolEnvelope;
  policy: A2ARuntimePolicy;
}

interface ValidPayload {
  acceptedPayload: unknown;
}

export function handleA2AEnvelope(input: HandleA2AEnvelopeInput): HandleA2AEnvelopeResult {
  const createdAt = (input.now ?? new Date()).toISOString();
  const envelope = ProtocolEnvelopeSchema.parse(input.envelope);
  const policy = effectivePolicy(input.policy);
  const context = { input, createdAt, envelope, policy };

  const guardResult = evaluateEnvelopeGuards(context);
  if (guardResult) return guardResult;

  const runId = runIdFromPayload(envelope.payload);
  const payloadResult = validateEnvelopePayload(context, runId);
  if ("decision" in payloadResult) return payloadResult;

  const remotePatchResult = routeRemotePatch(context, runId, payloadResult.acceptedPayload);
  if (remotePatchResult) return remotePatchResult;

  return acceptEnvelope(context, runId, payloadResult.acceptedPayload);
}

function evaluateEnvelopeGuards(context: ReceiveContext): HandleA2AEnvelopeResult | null {
  if (context.policy.mode === "disabled") {
    return blockEnvelope(context, "A2A runtime is disabled by policy", { kind: context.envelope.kind });
  }

  if (!context.envelope.a2a) {
    return blockEnvelope(context, "A2A metadata is required for runtime handling", { kind: context.envelope.kind });
  }

  const duplicate = duplicateDecision({
    cwd: context.input.cwd,
    envelope: context.envelope,
    createdAt: context.createdAt,
  });
  if (duplicate) {
    appendA2AAudit({
      cwd: context.input.cwd,
      eventType: "a2a_envelope_duplicate",
      timestamp: context.createdAt,
      payload: {
        messageId: context.envelope.a2a.messageId,
        duplicateOfRef: duplicate.duplicateOfRef,
      },
      ...(duplicate.runId ? { runId: duplicate.runId } : {}),
    });
    return { decision: duplicate, envelope: context.envelope };
  }

  const metadata = requireMetadata(context.envelope);
  const runId = runIdFromPayload(context.envelope.payload);
  if (metadata.recipientAgentId !== context.policy.localAgentId) {
    return blockEnvelope(
      context,
      "A2A recipient does not match local agent identity",
      { messageId: metadata.messageId },
      runId,
    );
  }

  if (!context.policy.trustedAgentIds.includes(metadata.senderAgentId)) {
    return blockEnvelope(context, "A2A sender is not trusted", { senderAgentId: metadata.senderAgentId }, runId);
  }

  if (!context.policy.acceptedKinds.includes(context.envelope.kind)) {
    return blockEnvelope(
      context,
      "A2A envelope kind is not accepted by policy",
      { kind: context.envelope.kind },
      runId,
    );
  }

  return null;
}

function validateEnvelopePayload(
  context: ReceiveContext,
  runId: string | undefined,
): HandleA2AEnvelopeResult | ValidPayload {
  const acceptedPayload = validatePayload(context.envelope);
  try {
    validateAttachments(context.envelope, context.input.incomingRoot);
  } catch (error) {
    return blockEnvelope(
      context,
      error instanceof Error ? error.message : String(error),
      { kind: context.envelope.kind },
      runId,
    );
  }

  return { acceptedPayload };
}

function routeRemotePatch(
  context: ReceiveContext,
  runId: string | undefined,
  acceptedPayload: unknown,
): HandleA2AEnvelopeResult | null {
  if (!isRemotePatch(context.envelope)) return null;

  if (context.policy.mode !== "filesystem") {
    return blockEnvelope(
      context,
      "Remote patch artifacts require local apply gates and are not accepted yet",
      { kind: context.envelope.kind },
      runId,
    );
  }

  if (!remotePatchAllowed(context.policy, context.envelope)) {
    return quarantineEnvelope(context, runId, acceptedPayload);
  }

  return null;
}

function blockEnvelope(
  context: ReceiveContext,
  reason: string,
  payload: Record<string, unknown>,
  runId?: string,
): HandleA2AEnvelopeResult {
  const blocked = decision({
    status: ContractValues.Blocked,
    reason,
    envelope: context.envelope,
    runId,
    createdAt: context.createdAt,
  });
  appendA2AAudit({
    cwd: context.input.cwd,
    eventType: "a2a_envelope_blocked",
    timestamp: context.createdAt,
    payload: { reason: blocked.reason, ...payload },
    ...(runId ? { runId } : {}),
  });
  return { decision: blocked, envelope: context.envelope };
}

function quarantineEnvelope(
  context: ReceiveContext,
  runId: string | undefined,
  acceptedPayload: unknown,
): HandleA2AEnvelopeResult {
  const metadata = requireMetadata(context.envelope);
  const ref = quarantineRef(metadata.messageId);
  const quarantined = decision({
    status: "accepted",
    reason: "Remote patch artifact quarantined pending local gates",
    envelope: context.envelope,
    runId,
    quarantineRef: ref,
    createdAt: context.createdAt,
  });
  persistQuarantinedEnvelope({
    cwd: context.input.cwd,
    envelope: context.envelope,
    acceptedPayload,
    decision: quarantined,
    envelopeRef: ref,
    sourceRoot: context.input.incomingRoot,
  });
  appendA2AAudit({
    cwd: context.input.cwd,
    eventType: "a2a_envelope_quarantined",
    timestamp: context.createdAt,
    payload: {
      messageId: metadata.messageId,
      kind: context.envelope.kind,
      quarantineRef: ref,
    },
    ...(runId ? { runId } : {}),
  });
  return { decision: quarantined, envelope: context.envelope };
}

function acceptEnvelope(
  context: ReceiveContext,
  runId: string | undefined,
  acceptedPayload: unknown,
): HandleA2AEnvelopeResult {
  const metadata = requireMetadata(context.envelope);
  const ref = inboxRef(metadata.messageId);
  const accepted = decision({
    status: "accepted",
    reason: "A2A envelope accepted into local inbox",
    envelope: context.envelope,
    runId,
    inboxRef: ref,
    createdAt: context.createdAt,
  });
  persistAcceptedEnvelope({
    cwd: context.input.cwd,
    envelope: context.envelope,
    acceptedPayload,
    decision: accepted,
    envelopeRef: ref,
    sourceRoot: context.input.incomingRoot,
  });
  appendA2AAudit({
    cwd: context.input.cwd,
    eventType: "a2a_envelope_accepted",
    timestamp: context.createdAt,
    payload: {
      messageId: metadata.messageId,
      kind: context.envelope.kind,
      inboxRef: ref,
    },
    ...(runId ? { runId } : {}),
  });

  return { decision: accepted, envelope: context.envelope };
}

function requireMetadata(envelope: ProtocolEnvelope): A2AMessageMetadata {
  if (!envelope.a2a) {
    throw new Error("A2A metadata is required");
  }
  return envelope.a2a;
}
