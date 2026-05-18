const RUN_ID_SCHEMA = {
  type: "object",
  properties: {
    runId: { type: "string" },
    workspacePath: { type: "string" },
    repoId: { type: "string" },
    repoPath: { type: "string" },
  },
  required: ["runId"],
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
    "Optional override command for controlled dev execution. Rejected unless the run riskProfile is dev or KIWI_ALLOW_MCP_COMMAND_OVERRIDE=1 is set on the server.",
} as const;

const WORKSPACE_PROPERTIES = {
  workspacePath: workspacePathProperty,
  repoId: repoIdProperty,
  repoPath: repoPathProperty,
} as const;

const TOOL_SPECS = [
  {
    name: "kiwi_doctor",
    description:
      "READ_ONLY. When to use: first tool for any kiwi task or when workspace/repo readiness is unclear. Requires: optional workspacePath plus repoId or repoPath for multi-repo workspaces. Returns: readiness, warnings, safeToPlan, safeToRun, and the first safe tool call.",
    inputSchema: {
      type: "object",
      properties: {
        ...WORKSPACE_PROPERTIES,
      },
    },
  },
  {
    name: "kiwi_plan",
    description: `WRITES_RUN_ARTIFACTS. When to use: create a TaskGraph from a ticket/rawInput after kiwi_doctor is safeToPlan. Requires: ticket or rawInput. Returns: run id, plan summary, cost forecast, and operatorCard. Next: call kiwi_preview_run or kiwi_next. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string", description: "Ticket text or markdown to plan." },
        rawInput: { type: "string", description: "Raw task text when no ticket field is used." },
        ...WORKSPACE_PROPERTIES,
        riskProfile: { type: "string", enum: ["dev", "production"], description: "Risk profile for planning policy." },
        budgetProfile: { type: "string", enum: ["tiny", "normal"], description: "Budget profile for planning policy." },
        allowStub: { type: "boolean", description: "Allow the stub planner provider in tests/dev fixtures." },
      },
      anyOf: [{ required: ["ticket"] }, { required: ["rawInput"] }],
    },
  },
  {
    name: "kiwi_status",
    description:
      "READ_ONLY. When to use: inspect current run state or list runs. Requires: optional runId. Returns: status and operatorCard for run-specific calls. Next: prefer kiwi_next for action selection.",
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        ...WORKSPACE_PROPERTIES,
      },
    },
  },
  {
    name: "kiwi_run",
    description: `MUTATES_WORKTREE. When to use: execute the exact plan after kiwi_preview_run has shown the decision card and user confirmed. Requires: runId and fresh previewToken. Returns: step results, final run state, and operatorCard. ${NO_AUTO_COMMIT_NOTE}`,
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
    },
  },
  {
    name: "kiwi_preview_run",
    description:
      "WRITES_RUN_ARTIFACTS. When to use: always before kiwi_run or kiwi_run_step. Requires: runId. Returns: decision card, step order, model/runner choices, cost, gates, mutation scope, and fresh previewToken. Next: ask the user to confirm, then call the returned recommendedToolCall.",
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
    },
  },
  {
    name: "kiwi_run_step",
    description: `MUTATES_WORKTREE. When to use: advanced single-step execution only after previewing that step. Requires: runId, stepId, fresh previewToken. Returns: attempt result and operatorCard. ${NO_AUTO_COMMIT_NOTE}`,
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
    },
  },
  {
    name: "kiwi_diff",
    description:
      "READ_ONLY. When to use: inspect generated patches or failure evidence. Requires: runId; optional stepId or all. Returns: patch stats and diff text.",
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        stepId: { type: "string", description: "Optional step id to narrow the diff." },
        all: { type: "boolean", description: "Return all attempt diffs instead of the latest materialized diff." },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_apply",
    description: `APPLIES_PATCH. When to use: apply a persisted kiwi patch to the source repo after inspecting kiwi_diff. Requires: runId. Unsafe apply overrides are not exposed over MCP. Returns: apply result and operatorCard. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: runIdProperty,
        stepId: { type: "string", description: "Optional step id to apply only that step's patch." },
        ...WORKSPACE_PROPERTIES,
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_finalize",
    description: `WRITES_RUN_ARTIFACTS. When to use: after run completion to write final verdict, summary, and cost report. Requires: runId. Returns: finalization result and operatorCard. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_cost",
    description:
      "READ_ONLY. When to use: inspect deterministic cost and model usage. Requires: runId. Returns: cost summary and operatorCard.",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_explain",
    description:
      "READ_ONLY. When to use: explain why models/runners/gates were selected. Requires: runId. Returns: routing, gates, cost summary, and operatorCard.",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_next",
    description:
      "READ_ONLY. When to use: default router after every run-related tool, error, or user interruption. Requires: runId. Returns: one exact recommendedToolCall, why it is safe now, expected mutation, and safe alternatives.",
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
    },
  },
  {
    name: "kiwi_request_approval",
    description:
      "WRITES_RUN_ARTIFACTS. When to use: only when kiwi_next says the run needs approval. Requires: runId, attemptId, and an explicit approvedBy identity (the placeholder 'mcp-operator' is not accepted). Returns: approval evidence and operatorCard.",
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
    },
  },
  {
    name: "kiwi_evidence_manifest",
    description:
      "WRITES_RUN_ARTIFACTS. When to use: after finalization to hash run evidence and write audit snapshot. Requires: runId. Returns: manifest artifact and operatorCard.",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_operator_snapshot",
    description:
      "WRITES_RUN_ARTIFACTS. When to use: after evidence is ready or when the operator view should be refreshed. Requires: runId. Returns: snapshot artifact and operatorCard.",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_publish_pr_draft",
    description:
      "PUSHES_BRANCH. When to use: only when the user explicitly requested PR draft publishing. Requires: runId and local git auth. Returns: branch push result, Bitbucket create-PR URL, and operatorCard. Does not store API credentials.",
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
    destructiveHint: false,
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

export const TOOLS = TOOL_SPECS.map((tool) => ({
  ...tool,
  annotations: TOOL_ANNOTATIONS[tool.name],
}));

export function listTools(): typeof TOOLS {
  return TOOLS;
}
