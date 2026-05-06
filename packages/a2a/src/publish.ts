import { copyFileSync, existsSync, mkdirSync, statSync } from "fs";
import path from "path";
import {
  A2AAttachmentDescriptor,
  Artifact,
  ArtifactSchema,
  ContractValues,
  GateResult,
  GateResultSchema,
  ProtocolEnvelopeSchema,
  ReviewVerdictSchema,
  StepAttemptSchema,
} from "@kiwi/contracts";
import {
  generateA2ACorrelationId,
  generateA2AMessageId,
  loadInitiative,
  loadTaskGraph,
  resolveRunArtifactPath,
} from "@kiwi/core";
import {
  mediaTypeFor,
  readJson,
  resolveA2APath,
  safeFileName,
  sha256File,
  validatePayload,
  writeJsonSafely,
  appendA2AAudit,
} from "./common";
import { ensureA2AStorage, requireEnabledConfig, requirePeer } from "./config";
import type { A2APublishInput, A2APublishResult } from "./types";

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
