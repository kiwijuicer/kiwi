import { A2ARuntimeDecision, Artifact, Initiative, ProtocolEnvelope, ProtocolEnvelopeKind } from "@kiwi/contracts";
import type { A2ARuntimePolicy } from "./common";

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
