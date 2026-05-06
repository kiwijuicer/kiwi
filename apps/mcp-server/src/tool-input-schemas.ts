import { z, ZodIssue } from "zod";

const WorkspaceSelectorSchema = z.object({
  workspacePath: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
});

const ProtocolEnvelopeKindValueSchema = z.enum([
  "initiative",
  "task_graph",
  "step_attempt",
  "gate_result",
  "review_verdict",
  "artifact",
]);

const RunIdSchema = WorkspaceSelectorSchema.extend({
  runId: z.string().min(1),
});

const OptionalRunIdSchema = WorkspaceSelectorSchema.extend({
  runId: z.string().min(1).optional(),
});

export const ToolInputSchemas = {
  kiwi_plan: WorkspaceSelectorSchema.extend({
    ticket: z.string().min(1).optional(),
    rawInput: z.string().min(1).optional(),
    riskProfile: z.enum(["dev", "production"]).optional(),
    budgetProfile: z.enum(["tiny", "normal"]).optional(),
  }).refine((value) => Boolean(value.ticket || value.rawInput), {
    message: "Either ticket or rawInput is required",
    path: ["ticket"],
  }),
  kiwi_status: OptionalRunIdSchema,
  kiwi_run: RunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    command: z.string().min(1).optional(),
    approved: z.boolean().optional(),
  }),
  kiwi_run_step: RunIdSchema.extend({
    stepId: z.string().min(1),
    command: z.string().min(1).optional(),
    approved: z.boolean().optional(),
  }),
  kiwi_finalize: RunIdSchema,
  kiwi_cost: RunIdSchema,
  kiwi_explain: RunIdSchema,
  kiwi_request_approval: RunIdSchema.extend({
    attemptId: z.string().min(1),
    reason: z.string().min(1).optional(),
    approvedBy: z.string().min(1).optional(),
  }),
  kiwi_evidence_manifest: RunIdSchema,
  kiwi_operator_snapshot: RunIdSchema,
  kiwi_publish_pr_draft: RunIdSchema.extend({
    remote: z.string().min(1).optional(),
    targetBranch: z.string().min(1).optional(),
    branchName: z.string().min(1).optional(),
  }),
  kiwi_a2a_receive: WorkspaceSelectorSchema.extend({
    envelope: z.unknown(),
    loopback: z.boolean().optional(),
    localAgentId: z.string().min(1).optional(),
    trustedAgentIds: z.array(z.string().min(1)).optional(),
  }),
  kiwi_a2a_config: WorkspaceSelectorSchema.extend({
    enabled: z.boolean().optional(),
    localAgentId: z.string().min(1).optional(),
  }),
  kiwi_a2a_trust_add: WorkspaceSelectorSchema.extend({
    agentId: z.string().min(1),
    inboxPath: z.string().min(1),
    allowRemotePatches: z.boolean().optional(),
  }),
  kiwi_a2a_trust_list: WorkspaceSelectorSchema,
  kiwi_a2a_trust_remove: WorkspaceSelectorSchema.extend({
    agentId: z.string().min(1),
  }),
  kiwi_a2a_publish: WorkspaceSelectorSchema.extend({
    peerAgentId: z.string().min(1),
    kind: ProtocolEnvelopeKindValueSchema,
    runId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    attemptId: z.string().min(1).optional(),
    gateId: z.string().min(1).optional(),
    artifactRef: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    payload: z.unknown().optional(),
  }),
  kiwi_a2a_sync: WorkspaceSelectorSchema,
  kiwi_a2a_inbox: WorkspaceSelectorSchema,
  kiwi_a2a_accept: WorkspaceSelectorSchema.extend({
    messageId: z.string().min(1),
  }),
} as const;

export type ToolSchemaName = keyof typeof ToolInputSchemas;

export class ToolInputValidationError extends Error {
  readonly code = -32602 as const;
  readonly issues: ZodIssue[];

  constructor(toolName: string, issues: ZodIssue[]) {
    super(`Invalid params for ${toolName}`);
    this.name = "ToolInputValidationError";
    this.issues = issues;
  }
}

export function validateToolArguments(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(ToolInputSchemas, name)) return args;
  const schema = ToolInputSchemas[name as ToolSchemaName];
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new ToolInputValidationError(name, parsed.error.issues);
  }
  return parsed.data as Record<string, unknown>;
}
