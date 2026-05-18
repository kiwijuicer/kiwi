import { z } from "zod";
import { IsoDateTimeSchema, ContractsSchemaVersionSchema } from "../shared/common";

export const EvidenceSubjectSchema = z.object({
  type: z.literal("diff"),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const AuditEventSchema = z.object({
  eventType: z.string().min(1),
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  timestamp: IsoDateTimeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const EvidenceFileHashSchema = z.object({
  ref: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(0),
});

export const RunAuditSnapshotSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  eventCount: z.number().int().min(0),
  events: z.array(AuditEventSchema),
  createdAt: IsoDateTimeSchema,
});

export const EvidenceManifestSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  generatedAt: IsoDateTimeSchema,
  auditSnapshotRef: z.string().min(1),
  files: z.array(EvidenceFileHashSchema),
});

export type EvidenceSubject = z.infer<typeof EvidenceSubjectSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type EvidenceFileHash = z.infer<typeof EvidenceFileHashSchema>;
export type RunAuditSnapshot = z.infer<typeof RunAuditSnapshotSchema>;
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
