import { z } from "zod";
import {
  A2A_RUNTIME_DECISION_STATUS_VALUES,
  A2A_RUNTIME_MODE_VALUES,
  ContractsSchemaVersionSchema,
  IsoDateTimeSchema,
  PROTOCOL_ENVELOPE_KIND_VALUES,
  enumFrom,
} from "./common";

export const ProtocolEnvelopeKindSchema = enumFrom(PROTOCOL_ENVELOPE_KIND_VALUES);

export const A2AAttachmentDescriptorSchema = z.object({
  ref: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(0),
  mediaType: z.string().min(1),
});

export const A2AMessageMetadataSchema = z.object({
  messageId: z.string().regex(/^msg_[a-z0-9_]+$/),
  correlationId: z.string().regex(/^corr_[a-z0-9_]+$/),
  idempotencyKey: z.string().min(8),
  senderAgentId: z.string().min(1),
  recipientAgentId: z.string().min(1),
  attachments: z.array(A2AAttachmentDescriptorSchema).optional(),
});

export const ProtocolEnvelopeSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  protocol: z.literal("a2a-prep"),
  kind: ProtocolEnvelopeKindSchema,
  payload: z.unknown(),
  createdAt: IsoDateTimeSchema,
  a2a: A2AMessageMetadataSchema.optional(),
});

export const A2ARuntimeModeSchema = enumFrom(A2A_RUNTIME_MODE_VALUES);
export const A2ARuntimeDecisionStatusSchema = enumFrom(A2A_RUNTIME_DECISION_STATUS_VALUES);

export const A2ARuntimeDecisionSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  status: A2ARuntimeDecisionStatusSchema,
  reason: z.string().min(1),
  messageId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  runId: z
    .string()
    .regex(/^run_[a-z0-9_]+$/)
    .optional(),
  inboxRef: z.string().min(1).optional(),
  quarantineRef: z.string().min(1).optional(),
  duplicateOfRef: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
});

export const A2ATrustedPeerSchema = z.object({
  agentId: z.string().min(1),
  inboxPath: z.string().min(1),
  allowRemotePatches: z.boolean().default(false),
});

export const A2AConfigSchema = z.object({
  enabled: z.boolean().default(false),
  localAgentId: z.string().min(1).default("kiwi-local"),
  acceptedKinds: z
    .array(ProtocolEnvelopeKindSchema)
    .default(["initiative", "task_graph", "step_attempt", "gate_result", "review_verdict", "artifact"]),
  peers: z.array(A2ATrustedPeerSchema).default([]),
});

export type A2AAttachmentDescriptor = z.infer<typeof A2AAttachmentDescriptorSchema>;
export type A2AMessageMetadata = z.infer<typeof A2AMessageMetadataSchema>;
export type ProtocolEnvelopeKind = z.infer<typeof ProtocolEnvelopeKindSchema>;
export type ProtocolEnvelope = z.infer<typeof ProtocolEnvelopeSchema>;
export type A2ARuntimeMode = z.infer<typeof A2ARuntimeModeSchema>;
export type A2ARuntimeDecisionStatus = z.infer<typeof A2ARuntimeDecisionStatusSchema>;
export type A2ARuntimeDecision = z.infer<typeof A2ARuntimeDecisionSchema>;
export type A2ATrustedPeer = z.infer<typeof A2ATrustedPeerSchema>;
export type A2AConfig = z.infer<typeof A2AConfigSchema>;
