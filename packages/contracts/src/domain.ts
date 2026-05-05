import { z } from "zod";
import {
  AgentRoleSchema,
  ArtifactTypeSchema,
  BudgetProfileSchema,
  InitiativeSourceSchema,
  IsoDateTimeSchema,
  ModelCapabilitySchema,
  RiskProfileSchema,
  RunStatusSchema,
  StepStatusSchema,
  StepTypeSchema,
} from "./common";

export const InitiativeSchema = z.object({
  id: z.string().regex(/^init_[a-z0-9_]+$/, "id must look like init_<value>"),
  title: z.string().min(1),
  rawInput: z.string().min(1),
  source: InitiativeSourceSchema,
  repoPath: z.string().min(1),
  riskProfile: RiskProfileSchema,
  budgetProfile: BudgetProfileSchema,
  createdAt: IsoDateTimeSchema,
});

export const StepSchema = z.object({
  stepId: z.string().regex(/^step_\d{3}$/, "stepId must look like step_001"),
  type: StepTypeSchema,
  title: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).min(1),
  requiredGates: z.array(z.string()).default([]),
  recommendedAgentRole: AgentRoleSchema,
  recommendedModelCapability: ModelCapabilitySchema,
  status: StepStatusSchema.default("pending"),
});

export const TaskGraphSchema = z.object({
  planId: z.string().regex(/^plan_[a-z0-9_]+$/),
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  initiativeId: z.string().regex(/^init_[a-z0-9_]+$/),
  summary: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  acceptanceCriteria: z.array(z.string()).min(1),
  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  riskScore: z.number().int().min(1).max(5),
  complexityScore: z.number().int().min(1).max(5),
  createdAt: IsoDateTimeSchema,
});

export const RunSchema = z.object({
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  initiativeId: z.string().regex(/^init_[a-z0-9_]+$/),
  currentPlanId: z.string().regex(/^plan_[a-z0-9_]+$/),
  status: RunStatusSchema,
  workspacePath: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const RunManifestSchema = RunSchema.extend({});

export const ArtifactSchema = z.object({
  type: ArtifactTypeSchema,
  ref: z.string().min(1),
  createdAt: IsoDateTimeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Initiative = z.infer<typeof InitiativeSchema>;
export type InitiativeSource = z.infer<typeof InitiativeSourceSchema>;
export type RiskProfile = z.infer<typeof RiskProfileSchema>;
export type BudgetProfile = z.infer<typeof BudgetProfileSchema>;
export type Step = z.infer<typeof StepSchema>;
export type StepType = z.infer<typeof StepTypeSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunManifest = Run;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
