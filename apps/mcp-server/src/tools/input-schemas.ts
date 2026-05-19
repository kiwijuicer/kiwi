import { z, ZodIssue } from "zod";

const WorkspaceSelectorSchema = z.object({
  workspacePath: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
});

const OptionalRunIdSchema = WorkspaceSelectorSchema.extend({
  runId: z.string().min(1).optional(),
});

const BLOCKED_APPROVER_IDENTITIES = new Set(["mcp-operator", "local-operator", "operator", "system"]);
export function isBlockedApproverIdentity(value: string): boolean {
  return BLOCKED_APPROVER_IDENTITIES.has(value.toLowerCase());
}

const ApprovedBySchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !isBlockedApproverIdentity(value), {
    message: "approvedBy must identify a real human/operator, not a placeholder identity",
  });

// Every leaf schema is .strict() so unknown MCP arguments (e.g. `forceUnsafe`,
// `approved`, typos) are rejected with -32602 invalid_input instead of being
// silently stripped. The base schemas stay non-strict so they remain extendable.
const ToolInputSchemas = {
  kiwi_doctor: WorkspaceSelectorSchema.strict(),
  kiwi_plan: WorkspaceSelectorSchema.extend({
    ticket: z.string().min(1).optional(),
    rawInput: z.string().min(1).optional(),
    riskProfile: z.enum(["dev", "production"]).optional(),
    budgetProfile: z.enum(["tiny", "normal"]).optional(),
  })
    .strict()
    .refine((value) => Boolean(value.ticket || value.rawInput), {
      message: "Either ticket or rawInput is required",
      path: ["ticket"],
    }),
  kiwi_status: OptionalRunIdSchema.strict(),
  kiwi_models_update: WorkspaceSelectorSchema.extend({
    catalogPath: z.string().min(1).optional(),
  }).strict(),
  kiwi_models_update_apply: WorkspaceSelectorSchema.extend({
    previewToken: z.string().min(1),
  }).strict(),
  kiwi_run: OptionalRunIdSchema.extend({
    previewToken: z.string().min(1),
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    command: z.string().min(1).optional(),
  }).strict(),
  kiwi_preview_run: OptionalRunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    command: z.string().min(1).optional(),
  }).strict(),
  kiwi_run_step: OptionalRunIdSchema.extend({
    stepId: z.string().min(1),
    previewToken: z.string().min(1),
    command: z.string().min(1).optional(),
  }).strict(),
  kiwi_diff: OptionalRunIdSchema.extend({
    stepId: z.string().min(1).optional(),
    all: z.boolean().optional(),
  }).strict(),
  kiwi_feedback: OptionalRunIdSchema.extend({
    message: z.string().min(1),
    author: z.string().min(1).optional(),
    targetStepId: z.string().min(1).optional(),
    targetAttemptId: z.string().min(1).optional(),
  }).strict(),
  kiwi_apply: OptionalRunIdSchema.extend({
    stepId: z.string().min(1).optional(),
    previewToken: z.string().min(1),
  }).strict(),
  kiwi_finalize: OptionalRunIdSchema.strict(),
  kiwi_cost: OptionalRunIdSchema.strict(),
  kiwi_explain: OptionalRunIdSchema.strict(),
  kiwi_next: OptionalRunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    command: z.string().min(1).optional(),
  }).strict(),
  kiwi_request_approval: OptionalRunIdSchema.extend({
    attemptId: z.string().min(1),
    reason: z.string().min(1).optional(),
    approvedBy: ApprovedBySchema,
  }).strict(),
  kiwi_evidence_manifest: OptionalRunIdSchema.strict(),
  kiwi_operator_snapshot: OptionalRunIdSchema.strict(),
  kiwi_publish_pr_draft: OptionalRunIdSchema.extend({
    remote: z.string().min(1).optional(),
    targetBranch: z.string().min(1).optional(),
    branchName: z.string().min(1).optional(),
  }).strict(),
} as const;

type ToolSchemaName = keyof typeof ToolInputSchemas;

export class ToolInputValidationError extends Error {
  readonly code = -32602 as const;
  readonly issues: ZodIssue[];

  constructor(toolName: string, issues: ZodIssue[]) {
    super(`Invalid params for ${toolName}`);
    this.name = "ToolInputValidationError";
    this.issues = issues;
  }
}

export function invalidToolArgumentIssue(path: Array<string | number>, message: string): ZodIssue {
  return {
    code: "custom",
    path,
    message,
  };
}

export function validateToolArguments(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(ToolInputSchemas, name)) {
    return args;
  }
  const schema = ToolInputSchemas[name as ToolSchemaName];
  const parsed = schema.safeParse(args);

  if (!parsed.success) {
    throw new ToolInputValidationError(name, parsed.error.issues);
  }

  return parsed.data as Record<string, unknown>;
}
