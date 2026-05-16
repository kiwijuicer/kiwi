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

const A2A_TOOL_NAMES = new Set([
  "kiwi_a2a_receive",
  "kiwi_a2a_config",
  "kiwi_a2a_trust_add",
  "kiwi_a2a_trust_list",
  "kiwi_a2a_trust_remove",
  "kiwi_a2a_publish",
  "kiwi_a2a_sync",
  "kiwi_a2a_inbox",
  "kiwi_a2a_accept",
]);

export function a2aMcpToolsEnabled(): boolean {
  return process.env.KIWI_A2A_MCP === "1";
}

export function isA2AToolName(name: string): boolean {
  return A2A_TOOL_NAMES.has(name);
}

export const TOOLS = [
  {
    name: "kiwi_doctor",
    description:
      "READ_ONLY: Diagnose workspace, repo, policy, git state, execution mode, A2A, and local CLI availability",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_plan",
    description: `WRITES_RUN_ARTIFACTS: Create a planned kiwi run. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string" },
        rawInput: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
        riskProfile: { type: "string", enum: ["dev", "production"] },
        budgetProfile: { type: "string", enum: ["tiny", "normal"] },
        allowStub: { type: "boolean" },
      },
      anyOf: [{ required: ["ticket"] }, { required: ["rawInput"] }],
    },
  },
  {
    name: "kiwi_status",
    description: "READ_ONLY: Read run status",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_run",
    description: `MUTATES_WORKTREE: Execute planned steps in order after kiwi_preview_run previewToken confirmation. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        previewToken: { type: "string" },
        fromStep: { type: "string" },
        maxConcurrency: { type: "integer", minimum: 1 },
        command: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_preview_run",
    description:
      "READ_ONLY: Preview step order, model switching, cost, gates, execution mode, and create a previewToken",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        fromStep: { type: "string" },
        maxConcurrency: { type: "integer", minimum: 1 },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_run_step",
    description: `MUTATES_WORKTREE: Execute one planned step through policy gates after kiwi_preview_run previewToken confirmation. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        previewToken: { type: "string" },
        command: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId", "stepId"],
    },
  },
  {
    name: "kiwi_diff",
    description: "READ_ONLY: Read persisted attempt patch stat and diff",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        all: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_apply",
    description: `APPLIES_PATCH: Apply a persisted worktree patch to the source repo. forceUnsafe requires KIWI_MCP_HIGH_RISK_TOOLS=1. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        forceUnsafe: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_finalize",
    description: `WRITES_RUN_ARTIFACTS: Finalize a run. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_cost",
    description: "READ_ONLY: Read deterministic run cost and model summary",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_explain",
    description: "READ_ONLY: Read routing reasons, gate status, cost, and next action",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_next",
    description: "READ_ONLY: Recommend the next safe kiwi MCP tool for a run",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        fromStep: { type: "string" },
        maxConcurrency: { type: "integer", minimum: 1 },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_request_approval",
    description: "WRITES_RUN_ARTIFACTS: Record an explicit approval decision for a blocked attempt",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        attemptId: { type: "string" },
        reason: { type: "string" },
        approvedBy: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId", "attemptId"],
    },
  },
  {
    name: "kiwi_evidence_manifest",
    description: "WRITES_RUN_ARTIFACTS: Write evidence manifest and audit snapshot",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_operator_snapshot",
    description: "WRITES_RUN_ARTIFACTS: Write local operator HTML snapshot",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_publish_pr_draft",
    description:
      "PUSHES_BRANCH: Push a local Bitbucket branch using existing git auth and write a PR draft artifact. Does not store API credentials.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        remote: { type: "string" },
        targetBranch: { type: "string" },
        branchName: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_a2a_receive",
    description: "WRITES_RUN_ARTIFACTS: Validate and optionally accept an A2A envelope into the local loopback inbox",
    inputSchema: {
      type: "object",
      properties: {
        envelope: { type: "object" },
        loopback: { type: "boolean" },
        localAgentId: { type: "string" },
        trustedAgentIds: { type: "array", items: { type: "string" } },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["envelope"],
    },
  },
  {
    name: "kiwi_a2a_config",
    description: "WRITES_RUN_ARTIFACTS: Read or update filesystem A2A config",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        localAgentId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_trust_add",
    description: "WRITES_RUN_ARTIFACTS: Trust an A2A filesystem peer",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        inboxPath: { type: "string" },
        allowRemotePatches: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["agentId", "inboxPath"],
    },
  },
  {
    name: "kiwi_a2a_trust_list",
    description: "READ_ONLY: List trusted A2A filesystem peers",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_trust_remove",
    description: "WRITES_RUN_ARTIFACTS: Remove a trusted A2A filesystem peer",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "kiwi_a2a_publish",
    description: "WRITES_RUN_ARTIFACTS: Queue a canonical A2A envelope for a trusted peer",
    inputSchema: {
      type: "object",
      properties: {
        peerAgentId: { type: "string" },
        kind: {
          type: "string",
          enum: ["initiative", "task_graph", "step_attempt", "gate_result", "review_verdict", "artifact"],
        },
        runId: { type: "string" },
        stepId: { type: "string" },
        attemptId: { type: "string" },
        gateId: { type: "string" },
        artifactRef: { type: "string" },
        correlationId: { type: "string" },
        idempotencyKey: { type: "string" },
        payload: { type: "object" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["peerAgentId", "kind"],
    },
  },
  {
    name: "kiwi_a2a_sync",
    description: "WRITES_RUN_ARTIFACTS: Deliver queued A2A envelopes and import incoming filesystem envelopes",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_inbox",
    description: "READ_ONLY: List accepted and quarantined A2A inbox items",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "kiwi_a2a_accept",
    description: "WRITES_RUN_ARTIFACTS: Materialize an incoming A2A initiative handoff as a local run",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["messageId"],
    },
  },
] as const;

export function listTools(): typeof TOOLS {
  if (a2aMcpToolsEnabled()) return TOOLS;
  return TOOLS.filter((tool) => !A2A_TOOL_NAMES.has(tool.name)) as unknown as typeof TOOLS;
}
