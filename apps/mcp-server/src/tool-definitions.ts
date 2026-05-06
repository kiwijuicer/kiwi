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

export const TOOLS = [
  {
    name: "kiwi_plan",
    description: `Create a planned kiwi run. ${NO_AUTO_COMMIT_NOTE}`,
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
      },
      anyOf: [{ required: ["ticket"] }, { required: ["rawInput"] }],
    },
  },
  {
    name: "kiwi_status",
    description: "Read run status",
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
    description: `Execute planned steps in order. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        fromStep: { type: "string" },
        command: { type: "string" },
        approved: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "kiwi_run_step",
    description: `Execute a planned step through policy gates. ${NO_AUTO_COMMIT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        stepId: { type: "string" },
        command: { type: "string" },
        approved: { type: "boolean" },
        workspacePath: { type: "string" },
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
      required: ["runId", "stepId"],
    },
  },
  { name: "kiwi_finalize", description: `Finalize a run. ${NO_AUTO_COMMIT_NOTE}`, inputSchema: RUN_ID_SCHEMA },
  { name: "kiwi_cost", description: "Read deterministic run cost and model summary", inputSchema: RUN_ID_SCHEMA },
  {
    name: "kiwi_explain",
    description: "Read routing reasons, gate status, cost, and next action",
    inputSchema: RUN_ID_SCHEMA,
  },
  {
    name: "kiwi_request_approval",
    description: "Record an approval decision",
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
    description: "Write evidence manifest and audit snapshot",
    inputSchema: RUN_ID_SCHEMA,
  },
  { name: "kiwi_operator_snapshot", description: "Write local operator HTML snapshot", inputSchema: RUN_ID_SCHEMA },
  {
    name: "kiwi_publish_pr_draft",
    description:
      "Push a local Bitbucket branch using existing git auth and write a PR draft artifact. Does not store API credentials.",
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
    description: "Validate and optionally accept an A2A envelope into the local loopback inbox",
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
    description: "Read or update filesystem A2A config",
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
    description: "Trust an A2A filesystem peer",
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
    description: "List trusted A2A filesystem peers",
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
    description: "Remove a trusted A2A filesystem peer",
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
    description: "Queue a canonical A2A envelope for a trusted peer",
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
    description: "Deliver queued A2A envelopes and import incoming filesystem envelopes",
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
    description: "List accepted and quarantined A2A inbox items",
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
    description: "Materialize an incoming A2A initiative handoff as a local run",
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
