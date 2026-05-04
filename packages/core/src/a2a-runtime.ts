import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  A2AAttachmentDescriptor,
  A2AConfig,
  A2ARuntimeDecision,
  A2ARuntimeDecisionSchema,
  A2ATrustedPeer,
  Artifact,
  ArtifactSchema,
  ContractValues,
  GateResult,
  GateResultSchema,
  Initiative,
  InitiativeSchema,
  ProtocolEnvelope,
  ProtocolEnvelopeKind,
  ProtocolEnvelopeSchema,
  ReviewVerdictSchema,
  StepAttemptSchema,
} from "@kiwi/contracts";
import { buildDeterministicTaskGraph, createInitiativeFromInput } from "./planner";
import { generateA2ACorrelationId, generateA2AMessageId, generateRunId } from "./ids";
import { loadKiwiConfig, loadPolicy, saveKiwiConfig } from "./config";
import { loadInitiative, loadTaskGraph, resolveRunArtifactPath, savePlannedRun } from "./run-store";
import {
  A2ARuntimePolicy,
  appendA2AAudit,
  atomicCopyFile,
  configPath,
  copyDirContents,
  decision,
  duplicateDecision,
  effectivePolicy,
  inboxRef,
  isRemotePatch,
  mediaTypeFor,
  moveA2AFile,
  persistAcceptedEnvelope,
  persistQuarantinedEnvelope,
  quarantineRef,
  readJson,
  remotePatchAllowed,
  resolveA2APath,
  runIdFromPayload,
  safeFileName,
  sha256File,
  validateAttachments,
  validatePayload,
  writeJsonSafely,
} from "./a2a-runtime-common";
export type { A2ARuntimePolicy } from "./a2a-runtime-common";

export interface HandleA2AEnvelopeInput {
  cwd: string;
  envelope: unknown;
  policy?: Partial<A2ARuntimePolicy>;
  incomingRoot?: string;
  now?: Date | undefined;
}

export interface HandleA2AEnvelopeResult {
  decision: A2ARuntimeDecision;
  envelope?: ProtocolEnvelope;
}

export interface A2APublishInput {
  cwd: string;
  peerAgentId: string;
  kind: ProtocolEnvelopeKind;
  runId?: string;
  stepId?: string;
  attemptId?: string;
  gateId?: string;
  artifactRef?: string;
  artifactType?: Artifact["type"];
  payload?: unknown;
  correlationId?: string;
  idempotencyKey?: string;
  now?: Date;
}

export interface A2APublishResult {
  envelope: ProtocolEnvelope;
  outboxRef: string;
}

export interface A2AImportDecision {
  sourceRef: string;
  decision: A2ARuntimeDecision;
}

export interface A2ASyncResult {
  delivered: string[];
  imported: A2AImportDecision[];
  blocked: A2AImportDecision[];
  duplicates: A2AImportDecision[];
  quarantined: string[];
}

export interface A2AInboxItem {
  messageId: string;
  correlationId: string;
  kind: ProtocolEnvelopeKind;
  senderAgentId: string;
  status: "pending" | "materialized" | "quarantined";
  reason: string;
  createdAt: string;
  inboxRef?: string;
  quarantineRef?: string;
  runId?: string;
  materializedRunId?: string;
}

export interface A2AAcceptHandoffInput {
  cwd: string;
  messageId: string;
  workspacePath?: string;
  repoId?: string;
  repoPath: string;
  now?: Date;
}

export interface A2AAcceptHandoffResult {
  runId: string;
  initiative: Initiative;
  messageId: string;
}

export function ensureA2AStorage(cwd: string): void {
  for (const ref of [
    "transport/incoming",
    "inbox",
    "idempotency",
    "ledger",
    "ledger/outbox",
    "ledger/imported",
    "ledger/blocked",
    "ledger/duplicates",
    "ledger/correlations",
    "attachments",
    "quarantine",
  ]) {
    mkdirSync(resolveA2APath(cwd, ref), { recursive: true });
  }
}

export function loadA2AConfig(cwd: string): A2AConfig {
  return loadKiwiConfig(configPath(cwd)).a2a;
}

export function saveA2AConfig(cwd: string, a2a: A2AConfig): A2AConfig {
  const current = loadKiwiConfig(configPath(cwd));
  return saveKiwiConfig(configPath(cwd), { ...current, a2a }).a2a;
}

export function setA2AEnabled(params: { cwd: string; enabled: boolean; localAgentId?: string }): A2AConfig {
  ensureA2AStorage(params.cwd);
  const current = loadA2AConfig(params.cwd);
  return saveA2AConfig(params.cwd, {
    ...current,
    enabled: params.enabled,
    localAgentId: params.localAgentId ?? current.localAgentId,
  });
}

export function addA2ATrustedPeer(params: {
  cwd: string;
  agentId: string;
  inboxPath: string;
  allowRemotePatches?: boolean;
}): A2AConfig {
  ensureA2AStorage(params.cwd);
  const current = loadA2AConfig(params.cwd);
  const nextPeer = {
    agentId: params.agentId,
    inboxPath: path.isAbsolute(params.inboxPath) ? params.inboxPath : path.resolve(params.cwd, params.inboxPath),
    allowRemotePatches: params.allowRemotePatches ?? false,
  };
  return saveA2AConfig(params.cwd, {
    ...current,
    peers: [...current.peers.filter((peer) => peer.agentId !== params.agentId), nextPeer],
  });
}

export function removeA2ATrustedPeer(params: { cwd: string; agentId: string }): A2AConfig {
  const current = loadA2AConfig(params.cwd);
  return saveA2AConfig(params.cwd, {
    ...current,
    peers: current.peers.filter((peer) => peer.agentId !== params.agentId),
  });
}

export function a2aPolicyFromConfig(config: A2AConfig): A2ARuntimePolicy {
  return {
    mode: config.enabled ? "filesystem" : "disabled",
    localAgentId: config.localAgentId,
    trustedAgentIds: config.peers.map((peer) => peer.agentId),
    trustedPeers: config.peers,
    acceptedKinds: config.acceptedKinds,
  };
}

export function handleA2AEnvelope(input: HandleA2AEnvelopeInput): HandleA2AEnvelopeResult {
  const createdAt = (input.now ?? new Date()).toISOString();
  const envelope = ProtocolEnvelopeSchema.parse(input.envelope);
  const policy = effectivePolicy(input.policy);

  if (policy.mode === "disabled") {
    const blocked = decision({
      status: ContractValues.Blocked,
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
      status: ContractValues.Blocked,
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
      status: ContractValues.Blocked,
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
      status: ContractValues.Blocked,
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
      status: ContractValues.Blocked,
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
  try {
    validateAttachments(envelope, input.incomingRoot);
  } catch (error) {
    const blocked = decision({
      status: ContractValues.Blocked,
      reason: error instanceof Error ? error.message : String(error),
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

  if (isRemotePatch(envelope) && policy.mode !== "filesystem") {
    const blocked = decision({
      status: ContractValues.Blocked,
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

  if (isRemotePatch(envelope) && !remotePatchAllowed(policy, envelope)) {
    const ref = quarantineRef(envelope.a2a.messageId);
    const quarantined = decision({
      status: "accepted",
      reason: "Remote patch artifact quarantined pending local gates",
      envelope,
      runId,
      quarantineRef: ref,
      createdAt,
    });
    persistQuarantinedEnvelope({
      cwd: input.cwd,
      envelope,
      acceptedPayload,
      decision: quarantined,
      envelopeRef: ref,
      sourceRoot: input.incomingRoot,
    });
    appendA2AAudit({
      cwd: input.cwd,
      eventType: "a2a_envelope_quarantined",
      timestamp: createdAt,
      payload: {
        messageId: envelope.a2a.messageId,
        kind: envelope.kind,
        quarantineRef: ref,
      },
      ...(runId ? { runId } : {}),
    });
    return { decision: quarantined, envelope };
  }

  const ref = inboxRef(envelope.a2a.messageId);
  const accepted = decision({
    status: "accepted",
    reason: "A2A envelope accepted into local inbox",
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
    sourceRoot: input.incomingRoot,
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

function requireEnabledConfig(cwd: string): A2AConfig {
  const config = loadA2AConfig(cwd);
  if (!config.enabled) {
    throw new Error("A2A filesystem runtime is disabled");
  }
  return config;
}

function requirePeer(config: A2AConfig, peerAgentId: string): A2ATrustedPeer {
  const peer = config.peers.find((entry) => entry.agentId === peerAgentId);
  if (!peer) {
    throw new Error(`A2A peer is not trusted: ${peerAgentId}`);
  }
  return peer;
}

function readGateResult(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  gateId?: string;
}): GateResult {
  const target = resolveRunArtifactPath(
    params.runId,
    `steps/${params.stepId}/${params.attemptId}/gate-results.json`,
    params.cwd,
  );
  const gateResults = (readJson(target) as unknown[]).map((entry) => GateResultSchema.parse(entry));
  const result = params.gateId ? gateResults.find((entry) => entry.gateId === params.gateId) : gateResults[0];
  if (!result) {
    throw new Error(`GateResult not found for ${params.stepId}/${params.attemptId}`);
  }
  return result;
}

function inferArtifactType(ref: string, explicit: Artifact["type"] | undefined): Artifact["type"] {
  if (explicit) return explicit;
  if (ref.endsWith(".patch")) return "patch";
  if (ref.endsWith(".diff")) return "diff";
  if (ref.includes("review")) return "review_report";
  if (ref.includes("cost")) return "cost_report";
  if (ref.includes(ContractValues.Lint)) return "lint_report";
  if (ref.includes(ContractValues.Typecheck)) return "typecheck_report";
  if (ref.includes("test")) return "test_report";
  if (ref.includes("summary")) return "summary";
  return "command_output";
}

function resolvePublishPayload(input: A2APublishInput, createdAt: string): unknown {
  if (input.payload !== undefined)
    return validatePayload({
      schemaVersion: "1",
      protocol: "a2a-prep",
      kind: input.kind,
      payload: input.payload,
      createdAt,
    });

  if (!input.runId) {
    throw new Error(`runId is required to publish ${input.kind}`);
  }

  switch (input.kind) {
    case "initiative":
      return loadInitiative(input.runId, input.cwd);
    case "task_graph":
      return loadTaskGraph(input.runId, input.cwd);
    case "step_attempt": {
      if (!input.stepId || !input.attemptId) {
        throw new Error("stepId and attemptId are required to publish a StepAttempt");
      }
      return StepAttemptSchema.parse(
        readJson(
          resolveRunArtifactPath(input.runId, `steps/${input.stepId}/${input.attemptId}/attempt.json`, input.cwd),
        ),
      );
    }
    case "gate_result": {
      if (!input.stepId || !input.attemptId) {
        throw new Error("stepId and attemptId are required to publish a GateResult");
      }
      const gateParams: {
        cwd: string;
        runId: string;
        stepId: string;
        attemptId: string;
        gateId?: string;
      } = {
        cwd: input.cwd,
        runId: input.runId,
        stepId: input.stepId,
        attemptId: input.attemptId,
      };
      if (input.gateId) gateParams.gateId = input.gateId;
      return readGateResult(gateParams);
    }
    case "review_verdict": {
      if (!input.stepId || !input.attemptId) {
        throw new Error("stepId and attemptId are required to publish a ReviewVerdict");
      }
      return ReviewVerdictSchema.parse(
        readJson(
          resolveRunArtifactPath(
            input.runId,
            `steps/${input.stepId}/${input.attemptId}/artifacts/review-report.json`,
            input.cwd,
          ),
        ),
      );
    }
    case "artifact": {
      if (!input.artifactRef) {
        throw new Error("artifactRef is required to publish an Artifact");
      }
      return ArtifactSchema.parse({
        type: inferArtifactType(input.artifactRef, input.artifactType),
        ref: input.artifactRef,
        createdAt,
      });
    }
  }
}

function writeOutboxAttachment(params: {
  cwd: string;
  runId: string;
  peerAgentId: string;
  messageId: string;
  artifactRef: string;
}): A2AAttachmentDescriptor[] {
  const source = resolveRunArtifactPath(params.runId, params.artifactRef, params.cwd);
  if (!existsSync(source)) {
    throw new Error(`Artifact not found: ${params.artifactRef}`);
  }
  const stats = statSync(source);
  if (!stats.isFile()) {
    throw new Error(`Artifact is not a file: ${params.artifactRef}`);
  }
  const ref = `attachments/${safeFileName(params.messageId)}/${safeFileName(path.basename(params.artifactRef))}`;
  const target = resolveA2APath(params.cwd, `outbox/${safeFileName(params.peerAgentId)}/${ref}`);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  return [
    {
      ref,
      sha256: sha256File(source),
      bytes: stats.size,
      mediaType: mediaTypeFor(params.artifactRef),
    },
  ];
}

export function publishA2AEnvelope(input: A2APublishInput): A2APublishResult {
  ensureA2AStorage(input.cwd);
  const config = requireEnabledConfig(input.cwd);
  const peer = requirePeer(config, input.peerAgentId);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const messageId = generateA2AMessageId(now);
  const correlationId = input.correlationId ?? generateA2ACorrelationId(input.runId ?? messageId);
  const payload = resolvePublishPayload(input, createdAt);
  const attachments =
    input.kind === "artifact" && input.runId && input.artifactRef
      ? writeOutboxAttachment({
          cwd: input.cwd,
          runId: input.runId,
          peerAgentId: peer.agentId,
          messageId,
          artifactRef: input.artifactRef,
        })
      : [];
  const envelope = ProtocolEnvelopeSchema.parse({
    schemaVersion: "1",
    protocol: "a2a-prep",
    kind: input.kind,
    payload,
    createdAt,
    a2a: {
      messageId,
      correlationId,
      idempotencyKey: input.idempotencyKey ?? `${config.localAgentId}:${peer.agentId}:${messageId}`,
      senderAgentId: config.localAgentId,
      recipientAgentId: peer.agentId,
      attachments,
    },
  });
  const outboxRef = `outbox/${safeFileName(peer.agentId)}/${safeFileName(messageId)}.json`;
  writeJsonSafely(resolveA2APath(input.cwd, outboxRef), envelope);
  appendA2AAudit({
    cwd: input.cwd,
    eventType: "a2a_outbox_queued",
    timestamp: createdAt,
    payload: {
      peerAgentId: peer.agentId,
      messageId,
      kind: input.kind,
      outboxRef,
    },
    ...(input.runId ? { runId: input.runId } : {}),
  });
  return { envelope, outboxRef };
}

function deliverPeerOutbox(params: { cwd: string; peer: A2ATrustedPeer }): string[] {
  const delivered: string[] = [];
  const outboxRef = `outbox/${safeFileName(params.peer.agentId)}`;
  const outboxDir = resolveA2APath(params.cwd, outboxRef);
  if (!existsSync(outboxDir)) return delivered;
  const inboxPath = path.isAbsolute(params.peer.inboxPath)
    ? params.peer.inboxPath
    : path.resolve(params.cwd, params.peer.inboxPath);
  mkdirSync(inboxPath, { recursive: true });

  for (const entry of readdirSync(outboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const source = path.join(outboxDir, entry.name);
    const envelope = ProtocolEnvelopeSchema.parse(readJson(source));
    const messageId = envelope.a2a?.messageId ?? entry.name.replace(/\.json$/, "");
    const sourceAttachments = path.join(outboxDir, "attachments", safeFileName(messageId));
    const targetAttachments = path.join(inboxPath, "attachments", safeFileName(messageId));
    copyDirContents(sourceAttachments, targetAttachments);
    atomicCopyFile(source, path.join(inboxPath, `${safeFileName(messageId)}.json`));
    moveA2AFile({
      cwd: params.cwd,
      source,
      targetRef: `ledger/outbox/${safeFileName(params.peer.agentId)}/${entry.name}`,
    });
    delivered.push(`${params.peer.agentId}/${entry.name}`);
  }

  return delivered;
}

function quarantineCorruptIncoming(params: {
  cwd: string;
  source: string;
  fileName: string;
  reason: string;
  timestamp: string;
}): string {
  const ref = `quarantine/corrupt-${Date.now()}-${safeFileName(params.fileName)}`;
  writeJsonSafely(resolveA2APath(params.cwd, `${ref}.reason.json`), {
    reason: params.reason,
    source: params.fileName,
    createdAt: params.timestamp,
  });
  moveA2AFile({ cwd: params.cwd, source: params.source, targetRef: ref });
  appendA2AAudit({
    cwd: params.cwd,
    eventType: "a2a_incoming_corrupt",
    timestamp: params.timestamp,
    payload: { reason: params.reason, source: params.fileName, quarantineRef: ref },
  });
  return ref;
}

export function importA2AIncoming(params: { cwd: string; now?: Date }): A2ASyncResult {
  ensureA2AStorage(params.cwd);
  const timestamp = (params.now ?? new Date()).toISOString();
  const config = loadA2AConfig(params.cwd);
  const policy = a2aPolicyFromConfig(config);
  const incomingRoot = resolveA2APath(params.cwd, "transport/incoming");
  const result: A2ASyncResult = {
    delivered: [],
    imported: [],
    blocked: [],
    duplicates: [],
    quarantined: [],
  };

  for (const entry of readdirSync(incomingRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const source = path.join(incomingRoot, entry.name);
    try {
      const envelope = readJson(source);
      const handled = handleA2AEnvelope({
        cwd: params.cwd,
        envelope,
        policy,
        incomingRoot,
        now: params.now,
      });
      const imported: A2AImportDecision = {
        sourceRef: `transport/incoming/${entry.name}`,
        decision: handled.decision,
      };
      if (handled.decision.status === "accepted") {
        result.imported.push(imported);
        if (handled.decision.quarantineRef) result.quarantined.push(handled.decision.quarantineRef);
        moveA2AFile({ cwd: params.cwd, source, targetRef: `ledger/imported/${entry.name}` });
      } else if (handled.decision.status === "duplicate") {
        result.duplicates.push(imported);
        moveA2AFile({ cwd: params.cwd, source, targetRef: `ledger/duplicates/${entry.name}` });
      } else {
        result.blocked.push(imported);
        moveA2AFile({ cwd: params.cwd, source, targetRef: `ledger/blocked/${entry.name}` });
      }
    } catch (error) {
      const ref = quarantineCorruptIncoming({
        cwd: params.cwd,
        source,
        fileName: entry.name,
        reason: error instanceof Error ? error.message : String(error),
        timestamp,
      });
      result.quarantined.push(ref);
    }
  }

  return result;
}

export function syncA2AFilesystem(params: { cwd: string; now?: Date }): A2ASyncResult {
  ensureA2AStorage(params.cwd);
  const config = requireEnabledConfig(params.cwd);
  const delivered = config.peers.flatMap((peer) => deliverPeerOutbox({ cwd: params.cwd, peer }));
  const imported = importA2AIncoming(params);
  return {
    ...imported,
    delivered,
  };
}

function inboxItemFromRecord(record: unknown, status: A2AInboxItem["status"]): A2AInboxItem {
  const value = record as {
    envelope?: unknown;
    decision?: unknown;
    materializedRunId?: unknown;
  };
  const envelope = ProtocolEnvelopeSchema.parse(value.envelope);
  const runtimeDecision = A2ARuntimeDecisionSchema.parse(value.decision);
  if (!envelope.a2a) {
    throw new Error("A2A inbox record is missing metadata");
  }
  const item: A2AInboxItem = {
    messageId: envelope.a2a.messageId,
    correlationId: envelope.a2a.correlationId,
    kind: envelope.kind,
    senderAgentId: envelope.a2a.senderAgentId,
    status,
    reason: runtimeDecision.reason,
    createdAt: runtimeDecision.createdAt,
  };
  if (runtimeDecision.inboxRef) item.inboxRef = runtimeDecision.inboxRef;
  if (runtimeDecision.quarantineRef) item.quarantineRef = runtimeDecision.quarantineRef;
  if (runtimeDecision.runId) item.runId = runtimeDecision.runId;
  if (typeof value.materializedRunId === "string") {
    item.status = "materialized";
    item.materializedRunId = value.materializedRunId;
  }
  return item;
}

export function listA2AInbox(params: { cwd: string; includeQuarantine?: boolean }): A2AInboxItem[] {
  ensureA2AStorage(params.cwd);
  const items: A2AInboxItem[] = [];
  const inboxDir = resolveA2APath(params.cwd, "inbox");
  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    items.push(inboxItemFromRecord(readJson(path.join(inboxDir, entry.name)), ContractValues.Pending));
  }
  if (params.includeQuarantine) {
    const quarantineDir = resolveA2APath(params.cwd, "quarantine");
    for (const entry of readdirSync(quarantineDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".reason.json")) continue;
      items.push(inboxItemFromRecord(readJson(path.join(quarantineDir, entry.name)), "quarantined"));
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

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
  const policy = loadPolicy(path.join(input.cwd, "kiwi-policy.yaml"));
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
