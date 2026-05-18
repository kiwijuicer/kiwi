const RUN_ID_SCHEMA = {
  type: "object",
  properties: {
    runId: { type: "string" },
    workspacePath: { type: "string" },
    repoId: { type: "string" },
    repoPath: { type: "string" },
  },
  required: ["runId"],
  additionalProperties: false,
} as const;

const NO_AUTO_COMMIT_NOTE =
  "Do not stage, commit, tag, or push unless the user explicitly requested that git operation.";

interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const workspacePathProperty = {
  type: "string",
  description: "Absolute workspace path. Use the server workspace when omitted.",
} as const;
const repoIdProperty = {
  type: "string",
  description: "Repo id from kiwi workspace list. Use repoId or repoPath for multi-repo workspaces.",
} as const;
const repoPathProperty = {
  type: "string",
  description: "Absolute repo path or path relative to workspacePath. Takes precedence over repoId.",
} as const;
const runIdProperty = { type: "string", description: "Kiwi run id returned by kiwi_plan." } as const;
const previewTokenProperty = {
  type: "string",
  description:
    "Fresh token returned by kiwi_preview_run for the same run, fromStep, maxConcurrency, repo state, and policy.",
} as const;
const commandOverrideProperty = {
  type: "string",
  description:
    "Optional override command for controlled dev execution. Rejected for production-risk runs unless the server explicitly enables overrides.",
} as const;

const WORKSPACE_PROPERTIES = {
  workspacePath: workspacePathProperty,
  repoId: repoIdProperty,
  repoPath: repoPathProperty,
} as const;

function describeTool(params: {
  risk: string;
  when: string;
  requires: string;
  returns: string;
  next?: string;
  includeSafetyNote?: boolean;
}): string {
  return [
    params.includeSafetyNote ? NO_AUTO_COMMIT_NOTE : null,
    `${params.risk}.`,
    `When to use: ${params.when}.`,
    `Requires: ${params.requires}.`,
    `Returns: ${params.returns}.`,
    params.next ? `Next: ${params.next}.` : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(" ");
}

const TOOL_SPECS = [
  {
    name: "kiwi_doctor",
    description: describeTool({
      risk: "READ_ONLY",
      when: "first tool for any kiwi task or when workspace/repo readiness is unclear",
      requires: "optional workspacePath plus repoId or repoPath for multi-repo workspaces",
      returns: "readiness, warnings, safeToPlan, safeToRun, and planning readiness",
    }),
    inputSchema: {
      type: "object",
      properties: {
        ...WORKSPACE_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_plan",
    description: describeTool({
      includeSafetyNote: true,
      risk: "WRITES_RUN_ARTIFACTS",
      when: "create a TaskGraph from a ticket/rawInput after kiwi_doctor is safeToPlan",
      requires: "ticket or rawInput",
      returns: "run id, plan summary, cost forecast, and operatorCard",
      next: "call kiwi_preview_run or kiwi_next",
    }),
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string", description: "Ticket text or markdown to plan." },
        rawInput: { type: "string", description: "Raw task text when no ticket field is used." },
        ...WORKSPACE_PROPERTIES,
        riskProfile: { type: "string", enum: ["dev", "production"], description: "Risk profile for planning policy." },
        budgetProfile: { type: "string", enum: ["tiny", "normal"], description: "Budget profile for planning policy." },
      },
      anyOf: [{ required: ["ticket"] }, { required: ["rawInput"] }],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_status",
    description: describeTool({
      risk: "READ_ONLY",
      when: "inspect current run state or list runs",
      requires: "optional runId",
      returns: "status and operatorCard for run-specific calls",
      next: "prefer kiwi_next for action selection",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        ...WORKSPACE_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_run",
    description: describeTool({
      includeSafetyNote: true,
      risk: "MUTATES_WORKTREE",
      when: "execute the exact plan after kiwi_preview_run has shown the decision card and user confirmed",
      requires: "runId and fresh previewToken",
      returns: "step results, final run state, and operatorCard",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        previewToken: previewTokenProperty,
        fromStep: { type: "string", description: "Optional first step id; must match the preview." },
        maxConcurrency: {
          type: "integer",
          minimum: 1,
          description: "Maximum concurrent scheduled steps; must match the preview.",
        },
        command: commandOverrideProperty,
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId", "previewToken"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_preview_run",
    description: describeTool({
      includeSafetyNote: true,
      risk: "WRITES_RUN_ARTIFACTS",
      when: "always before kiwi_run, kiwi_run_step, or kiwi_apply",
      requires: "runId",
      returns: "decision card, step order, model/runner choices, cost, gates, mutation scope, and fresh previewToken",
      next: "ask the user to confirm, then call the returned recommendedToolCall",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        fromStep: { type: "string", description: "Optional first step id for partial execution preview." },
        maxConcurrency: {
          type: "integer",
          minimum: 1,
          description: "Maximum concurrent scheduled steps to bind into the preview token.",
        },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_run_step",
    description: describeTool({
      includeSafetyNote: true,
      risk: "MUTATES_WORKTREE",
      when: "advanced single-step execution only after previewing that step",
      requires: "runId, stepId, fresh previewToken",
      returns: "attempt result and operatorCard",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        stepId: { type: "string", description: "Step id included in the preview token." },
        previewToken: previewTokenProperty,
        command: commandOverrideProperty,
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId", "stepId", "previewToken"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_diff",
    description: describeTool({
      risk: "READ_ONLY",
      when: "inspect generated patches or failure evidence",
      requires: "runId; optional stepId or all",
      returns: "patch stats and diff text",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        stepId: { type: "string", description: "Optional step id to narrow the diff." },
        all: { type: "boolean", description: "Return all attempt diffs instead of the latest materialized diff." },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_apply",
    description: describeTool({
      includeSafetyNote: true,
      risk: "APPLIES_PATCH",
      when: "apply a persisted kiwi patch to the source repo after inspecting kiwi_diff and previewing the run",
      requires: "runId and fresh previewToken. Unsafe apply overrides are not exposed over MCP",
      returns: "apply result and operatorCard",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        stepId: { type: "string", description: "Optional step id to apply only that step's patch." },
        previewToken: previewTokenProperty,
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId", "previewToken"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_finalize",
    description: describeTool({
      includeSafetyNote: true,
      risk: "WRITES_RUN_ARTIFACTS",
      when: "after run completion to write final verdict, summary, and cost report",
      requires: "runId",
      returns: "finalization result and operatorCard",
    }),
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_cost",
    description: describeTool({
      risk: "READ_ONLY",
      when: "inspect deterministic cost and model usage",
      requires: "runId",
      returns: "cost summary and operatorCard",
    }),
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_explain",
    description: describeTool({
      risk: "READ_ONLY",
      when: "explain why models/runners/gates were selected",
      requires: "runId",
      returns: "routing, gates, cost summary, and operatorCard",
    }),
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_next",
    description: describeTool({
      risk: "READ_ONLY",
      when: "default router after every run-related tool, error, or user interruption",
      requires: "runId",
      returns:
        "one executable recommendedToolCall when available, why it is safe now, expected mutation, and safe alternatives",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        fromStep: { type: "string", description: "Optional first step id for the next run preview/execution." },
        maxConcurrency: {
          type: "integer",
          minimum: 1,
          description: "Maximum concurrency to bind into preview/run recommendations.",
        },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_request_approval",
    description: describeTool({
      includeSafetyNote: true,
      risk: "WRITES_RUN_ARTIFACTS",
      when: "only when kiwi_next says the run needs approval",
      requires: "runId, attemptId, and an explicit approvedBy identity; placeholder identities are rejected",
      returns: "approval evidence and operatorCard",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        attemptId: { type: "string", description: "Blocked attempt id from kiwi_next or status." },
        reason: { type: "string", description: "Human approval reason." },
        approvedBy: {
          type: "string",
          minLength: 1,
          description: "Identity of the human or operator approving this attempt. Required for audit.",
        },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId", "attemptId", "approvedBy"],
      additionalProperties: false,
    },
  },
  {
    name: "kiwi_evidence_manifest",
    description: describeTool({
      includeSafetyNote: true,
      risk: "WRITES_RUN_ARTIFACTS",
      when: "after finalization to hash run evidence and write audit snapshot",
      requires: "runId",
      returns: "manifest artifact and operatorCard",
    }),
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_operator_snapshot",
    description: describeTool({
      includeSafetyNote: true,
      risk: "WRITES_RUN_ARTIFACTS",
      when: "after evidence is ready or when the operator view should be refreshed",
      requires: "runId",
      returns: "snapshot artifact and operatorCard",
    }),
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_publish_pr_draft",
    description: describeTool({
      includeSafetyNote: true,
      risk: "PUSHES_BRANCH",
      when: "only when the user explicitly requested PR draft publishing",
      requires: "runId and local git auth",
      returns: "branch push result, Bitbucket create-PR URL, and operatorCard. Does not store API credentials",
    }),
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        remote: { type: "string", description: "Git remote to push to." },
        targetBranch: { type: "string", description: "PR target branch." },
        branchName: { type: "string", description: "Local/remote branch name to create or push." },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId"],
      additionalProperties: false,
    },
  },
] as const;

type ToolName = (typeof TOOL_SPECS)[number]["name"];

const TOOL_ANNOTATIONS: Record<ToolName, ToolAnnotations> = {
  kiwi_doctor: {
    title: "Diagnose kiwi workspace readiness",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  kiwi_plan: {
    title: "Create planned kiwi run",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_status: {
    title: "Read kiwi run status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  kiwi_run: {
    title: "Execute planned kiwi run",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_preview_run: {
    title: "Preview kiwi run execution",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_run_step: {
    title: "Execute one planned kiwi step",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_diff: {
    title: "Read kiwi run diff",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  kiwi_apply: {
    title: "Apply kiwi patch",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_finalize: {
    title: "Finalize kiwi run",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_cost: {
    title: "Read kiwi run cost",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  kiwi_explain: {
    title: "Explain kiwi run decisions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  kiwi_next: {
    title: "Recommend next safe kiwi tool",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  kiwi_request_approval: {
    title: "Record kiwi approval",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_evidence_manifest: {
    title: "Write kiwi evidence manifest",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_operator_snapshot: {
    title: "Write kiwi operator snapshot",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  kiwi_publish_pr_draft: {
    title: "Publish kiwi PR draft branch",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const TOOL_DEFINITIONS = TOOL_SPECS.map((tool) => ({
  ...tool,
  annotations: TOOL_ANNOTATIONS[tool.name],
}));

export function listTools(): typeof TOOL_DEFINITIONS {
  return TOOL_DEFINITIONS;
}
