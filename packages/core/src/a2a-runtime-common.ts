import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { createHash } from "crypto";
import {
  A2ARuntimeDecision,
  A2ARuntimeDecisionSchema,
  A2ARuntimeMode,
  A2ATrustedPeer,
  ArtifactSchema,
  GateResultSchema,
  InitiativeSchema,
  ProtocolEnvelope,
  ProtocolEnvelopeKind,
  ReviewVerdictSchema,
  StepAttemptSchema,
  TaskGraphSchema,
} from "@kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";

export interface A2ARuntimePolicy {
  mode: A2ARuntimeMode;
  localAgentId: string;
  trustedAgentIds: string[];
  trustedPeers: A2ATrustedPeer[];
  acceptedKinds: ProtocolEnvelopeKind[];
}

export const DEFAULT_POLICY: A2ARuntimePolicy = {
  mode: "disabled",
  localAgentId: "kiwi-local",
  trustedAgentIds: [],
  trustedPeers: [],
  acceptedKinds: ["task_graph", "step_attempt", "gate_result", "review_verdict", "artifact"],
};

export function effectivePolicy(policy: Partial<A2ARuntimePolicy> | undefined): A2ARuntimePolicy {
  const trustedPeers = policy?.trustedPeers ?? DEFAULT_POLICY.trustedPeers;
  const trustedAgentIds =
    policy?.trustedAgentIds ?? trustedPeers.map((peer) => peer.agentId) ?? DEFAULT_POLICY.trustedAgentIds;
  return {
    ...DEFAULT_POLICY,
    ...policy,
    trustedAgentIds,
    trustedPeers,
    acceptedKinds: policy?.acceptedKinds ?? DEFAULT_POLICY.acceptedKinds,
  };
}

export function a2aRoot(cwd: string): string {
  return path.join(cwd, ".kiwi", "a2a");
}

export function configPath(cwd: string): string {
  return path.join(cwd, ".kiwi", "config.yaml");
}

export function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

export function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

export function idempotencyRef(idempotencyKey: string): string {
  return `idempotency/${safeFileName(idempotencyKey)}.json`;
}

export function inboxRef(messageId: string): string {
  return `inbox/${safeFileName(messageId)}.json`;
}

export function quarantineRef(messageId: string): string {
  return `quarantine/${safeFileName(messageId)}.json`;
}

export function correlationRef(correlationId: string, messageId: string): string {
  return `ledger/correlations/${safeFileName(correlationId)}/${safeFileName(messageId)}.json`;
}

export function resolveA2APath(cwd: string, ref: string): string {
  const base = path.resolve(a2aRoot(cwd));
  const target = path.resolve(base, ref);
  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`A2A path escapes storage root: ${ref}`);
  }
  return target;
}

export function resolveChildPath(root: string, ref: string): string {
  if (path.isAbsolute(ref)) {
    throw new Error("A2A attachment ref must be relative");
  }
  const base = path.resolve(root);
  const target = path.resolve(base, ref);
  if (!(target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`A2A path escapes root: ${ref}`);
  }
  return target;
}

export function moveA2AFile(params: { cwd: string; source: string; targetRef: string }): void {
  const target = resolveA2APath(params.cwd, params.targetRef);
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(params.source, target);
}

export function sha256File(target: string): string {
  return createHash("sha256").update(readFileSync(target)).digest("hex");
}

export function mediaTypeFor(ref: string): string {
  if (ref.endsWith(".json")) return "application/json";
  if (ref.endsWith(".patch") || ref.endsWith(".diff")) return "text/x-patch";
  if (ref.endsWith(".md")) return "text/markdown";
  if (ref.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

export function copyDirContents(source: string, target: string): void {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(sourcePath, targetPath);
    } else if (entry.isFile()) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

export function atomicCopyFile(source: string, target: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  copyFileSync(source, tempPath);
  renameSync(tempPath, target);
}

export function runIdFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as { runId?: unknown }).runId;
  return typeof value === "string" && /^run_[a-z0-9_]+$/.test(value) ? value : undefined;
}

export function decision(params: {
  status: A2ARuntimeDecision["status"];
  reason: string;
  createdAt: string;
  envelope?: ProtocolEnvelope | undefined;
  runId?: string | undefined;
  inboxRef?: string | undefined;
  quarantineRef?: string | undefined;
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
  if (params.quarantineRef) value.quarantineRef = params.quarantineRef;
  if (params.duplicateOfRef) value.duplicateOfRef = params.duplicateOfRef;
  return A2ARuntimeDecisionSchema.parse(value);
}

export function appendA2AAudit(params: {
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

export function validatePayload(envelope: ProtocolEnvelope): unknown {
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

export function isRemotePatch(envelope: ProtocolEnvelope): boolean {
  if (envelope.kind !== "artifact") return false;
  const artifact = ArtifactSchema.parse(envelope.payload);
  return artifact.type === "diff" || artifact.type === "patch";
}

export function peerForSender(policy: A2ARuntimePolicy, senderAgentId: string): A2ATrustedPeer | undefined {
  return policy.trustedPeers.find((peer) => peer.agentId === senderAgentId);
}

export function remotePatchAllowed(policy: A2ARuntimePolicy, envelope: ProtocolEnvelope): boolean {
  if (!envelope.a2a) return false;
  return peerForSender(policy, envelope.a2a.senderAgentId)?.allowRemotePatches === true;
}

export function duplicateDecision(params: {
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

export function validateAttachments(envelope: ProtocolEnvelope, root: string | undefined): void {
  const attachments = envelope.a2a?.attachments ?? [];
  if (attachments.length === 0) return;
  if (!root) {
    throw new Error("A2A attachment validation requires an incoming root");
  }

  for (const attachment of attachments) {
    const target = resolveChildPath(root, attachment.ref);
    if (!existsSync(target)) {
      throw new Error(`A2A attachment not found: ${attachment.ref}`);
    }
    const stats = statSync(target);
    if (!stats.isFile()) {
      throw new Error(`A2A attachment is not a file: ${attachment.ref}`);
    }
    if (stats.size !== attachment.bytes) {
      throw new Error(`A2A attachment size mismatch: ${attachment.ref}`);
    }
    const actualHash = sha256File(target);
    if (actualHash !== attachment.sha256) {
      throw new Error(`A2A attachment hash mismatch: ${attachment.ref}`);
    }
  }
}

export function persistAttachmentCopies(params: {
  cwd: string;
  envelope: ProtocolEnvelope;
  sourceRoot?: string | undefined;
}): void {
  const attachments = params.envelope.a2a?.attachments ?? [];
  if (attachments.length === 0 || !params.sourceRoot || !params.envelope.a2a) return;

  const targetRoot = resolveA2APath(params.cwd, `attachments/${safeFileName(params.envelope.a2a.messageId)}`);
  for (const attachment of attachments) {
    const source = resolveChildPath(params.sourceRoot, attachment.ref);
    const target = path.join(targetRoot, path.basename(attachment.ref));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

export function persistIdempotency(params: {
  cwd: string;
  envelope: ProtocolEnvelope;
  envelopeRef: string;
  decision: A2ARuntimeDecision;
}): void {
  const metadata = params.envelope.a2a;
  if (!metadata) throw new Error("A2A metadata is required");
  writeJsonSafely(resolveA2APath(params.cwd, idempotencyRef(metadata.idempotencyKey)), {
    idempotencyKey: metadata.idempotencyKey,
    envelopeRef: params.envelopeRef,
    decision: params.decision,
  });
}

export function persistAcceptedEnvelope(params: {
  cwd: string;
  envelope: ProtocolEnvelope;
  acceptedPayload: unknown;
  decision: A2ARuntimeDecision;
  envelopeRef: string;
  sourceRoot?: string | undefined;
}): void {
  const metadata = params.envelope.a2a;
  if (!metadata) throw new Error("A2A metadata is required");
  const record = {
    envelope: params.envelope,
    acceptedPayload: params.acceptedPayload,
    decision: params.decision,
    materializedRunId: null,
  };
  writeJsonSafely(resolveA2APath(params.cwd, params.envelopeRef), record);
  writeJsonSafely(resolveA2APath(params.cwd, correlationRef(metadata.correlationId, metadata.messageId)), {
    envelopeRef: params.envelopeRef,
    decision: params.decision,
  });
  persistAttachmentCopies({ cwd: params.cwd, envelope: params.envelope, sourceRoot: params.sourceRoot });
  persistIdempotency({
    cwd: params.cwd,
    envelope: params.envelope,
    envelopeRef: params.envelopeRef,
    decision: params.decision,
  });
}

export function persistQuarantinedEnvelope(params: {
  cwd: string;
  envelope: ProtocolEnvelope;
  acceptedPayload: unknown;
  decision: A2ARuntimeDecision;
  envelopeRef: string;
  sourceRoot?: string | undefined;
}): void {
  const metadata = params.envelope.a2a;
  if (!metadata) throw new Error("A2A metadata is required");
  writeJsonSafely(resolveA2APath(params.cwd, params.envelopeRef), {
    envelope: params.envelope,
    acceptedPayload: params.acceptedPayload,
    decision: params.decision,
    quarantineReason: params.decision.reason,
  });
  writeJsonSafely(resolveA2APath(params.cwd, correlationRef(metadata.correlationId, metadata.messageId)), {
    envelopeRef: params.envelopeRef,
    decision: params.decision,
  });
  persistAttachmentCopies({ cwd: params.cwd, envelope: params.envelope, sourceRoot: params.sourceRoot });
  persistIdempotency({
    cwd: params.cwd,
    envelope: params.envelope,
    envelopeRef: params.envelopeRef,
    decision: params.decision,
  });
}
