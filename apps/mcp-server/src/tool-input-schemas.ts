import { z, ZodIssue } from "zod";

const WorkspaceSelectorSchema = z.object({
  workspacePath: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
});

const RunIdSchema = WorkspaceSelectorSchema.extend({
  runId: z.string().min(1),
});

const OptionalRunIdSchema = WorkspaceSelectorSchema.extend({
  runId: z.string().min(1).optional(),
});

const BLOCKED_APPROVER_IDENTITIES = new Set(["mcp-operator", "local-operator", "operator", "system"]);
const ApprovedBySchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !BLOCKED_APPROVER_IDENTITIES.has(value.toLowerCase()), {
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
    allowStub: z.boolean().optional(),
  })
    .strict()
    .refine((value) => Boolean(value.ticket || value.rawInput), {
      message: "Either ticket or rawInput is required",
      path: ["ticket"],
    }),
  kiwi_status: OptionalRunIdSchema.strict(),
  kiwi_run: RunIdSchema.extend({
    previewToken: z.string().min(1),
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    command: z.string().min(1).optional(),
  }).strict(),
  kiwi_preview_run: RunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
  }).strict(),
  kiwi_run_step: RunIdSchema.extend({
    stepId: z.string().min(1),
    previewToken: z.string().min(1),
    command: z.string().min(1).optional(),
  }).strict(),
  kiwi_diff: RunIdSchema.extend({
    stepId: z.string().min(1).optional(),
    all: z.boolean().optional(),
  }).strict(),
  kiwi_apply: RunIdSchema.extend({
    stepId: z.string().min(1).optional(),
  }).strict(),
  kiwi_finalize: RunIdSchema.strict(),
  kiwi_cost: RunIdSchema.strict(),
  kiwi_explain: RunIdSchema.strict(),
  kiwi_next: RunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
  }).strict(),
  kiwi_request_approval: RunIdSchema.extend({
    attemptId: z.string().min(1),
    reason: z.string().min(1).optional(),
    approvedBy: ApprovedBySchema,
  }).strict(),
  kiwi_evidence_manifest: RunIdSchema.strict(),
  kiwi_operator_snapshot: RunIdSchema.strict(),
  kiwi_publish_pr_draft: RunIdSchema.extend({
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
