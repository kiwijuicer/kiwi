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

const ToolInputSchemas = {
  kiwi_doctor: WorkspaceSelectorSchema,
  kiwi_plan: WorkspaceSelectorSchema.extend({
    ticket: z.string().min(1).optional(),
    rawInput: z.string().min(1).optional(),
    riskProfile: z.enum(["dev", "production"]).optional(),
    budgetProfile: z.enum(["tiny", "normal"]).optional(),
    allowStub: z.boolean().optional(),
  }).refine((value) => Boolean(value.ticket || value.rawInput), {
    message: "Either ticket or rawInput is required",
    path: ["ticket"],
  }),
  kiwi_status: OptionalRunIdSchema,
  kiwi_run: RunIdSchema.extend({
    previewToken: z.string().min(1),
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    command: z.string().min(1).optional(),
  }),
  kiwi_preview_run: RunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
  }),
  kiwi_run_step: RunIdSchema.extend({
    stepId: z.string().min(1),
    previewToken: z.string().min(1),
    command: z.string().min(1).optional(),
  }),
  kiwi_diff: RunIdSchema.extend({
    stepId: z.string().min(1).optional(),
    all: z.boolean().optional(),
  }),
  kiwi_apply: RunIdSchema.extend({
    stepId: z.string().min(1).optional(),
  }).strict(),
  kiwi_finalize: RunIdSchema,
  kiwi_cost: RunIdSchema,
  kiwi_explain: RunIdSchema,
  kiwi_next: RunIdSchema.extend({
    fromStep: z.string().min(1).optional(),
    maxConcurrency: z.number().int().positive().optional(),
  }),
  kiwi_request_approval: RunIdSchema.extend({
    attemptId: z.string().min(1),
    reason: z.string().min(1).optional(),
    approvedBy: z.string().min(1),
  }),
  kiwi_evidence_manifest: RunIdSchema,
  kiwi_operator_snapshot: RunIdSchema,
  kiwi_publish_pr_draft: RunIdSchema.extend({
    remote: z.string().min(1).optional(),
    targetBranch: z.string().min(1).optional(),
    branchName: z.string().min(1).optional(),
  }),
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
