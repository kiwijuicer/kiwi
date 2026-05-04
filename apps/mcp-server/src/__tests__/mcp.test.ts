import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createMcpMessageDrainer, handleMcpRequest } from "../index";

function setupRepo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-"));
  mkdirSync(path.join(cwd, ".kiwi", "runs"), { recursive: true });
  mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });
  writeFileSync(path.join(cwd, ".kiwi", "config.yaml"), "version: \"1\"\n", "utf-8");
  writeFileSync(
    path.join(cwd, "kiwi-policy.yaml"),
    `version: "1"
project:
  name: kiwi
  language: typescript
  packageManager: pnpm
commands:
  test: node -e 0
  lint: node -e 0
  typecheck: node -e 0
routing:
  defaultAgentRole: executor
  defaultModelCapability: mid
  stepTypeOverrides: {}
riskZones:
  high: []
approvals:
  requireFor: []
  commandApprovalStates: {}
commandProfiles:
  default:
    allowedCommands: [node]
    approvalState: auto
    approvalRequiredPaths: []
    deniedPaths: []
    envAllowlist: [PATH]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 1000
    maxOutputBytes: 4096
`,
    "utf-8",
  );
  writeFileSync(
    path.join(cwd, "model-registry.yaml"),
    `version: "1"
models:
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer]
    enabled: true
`,
    "utf-8",
  );
  return cwd;
}

function setupWorkspace(): { root: string; core: string; agent: string } {
  const root = setupRepo();
  const core = path.join(root, "voice-core");
  const agent = path.join(root, "voice-livekit-agent");
  mkdirSync(core);
  mkdirSync(agent);
  writeFileSync(path.join(core, "core.txt"), "core\n", "utf-8");
  writeFileSync(path.join(agent, "agent.txt"), "agent\n", "utf-8");
  writeFileSync(
    path.join(root, "workspace.code-workspace"),
    JSON.stringify({
      folders: [
        { name: "voice-core", path: "voice-core" },
        { name: "voice-livekit-agent", path: "voice-livekit-agent" },
      ],
    }),
    "utf-8",
  );
  return { root, core, agent };
}

function toolJson(response: Awaited<ReturnType<typeof handleMcpRequest>>): unknown {
  const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
  return JSON.parse(text) as unknown;
}

function framedMessage(value: unknown): Buffer {
  const body = JSON.stringify(value);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`, "utf-8");
}

describe("MCP server", () => {
  it("initializes and lists tools", async () => {
    const response = await handleMcpRequest({ id: 1, method: "initialize" }, setupRepo());
    expect(response.error).toBeUndefined();
    expect((response.result as { serverInfo: { name: string } }).serverInfo.name).toBe("kiwi");

    const tools = await handleMcpRequest({ id: 2, method: "tools/list" }, setupRepo());
    expect(tools.error).toBeUndefined();
    expect(JSON.stringify(tools.result)).toContain("kiwi_plan");
    expect(JSON.stringify(tools.result)).toContain("inputSchema");
  });

  it("drains multiple stdio messages from one chunk and skips notifications", async () => {
    const responses: unknown[] = [];
    const drain = createMcpMessageDrainer(setupRepo(), (response) => responses.push(response));

    await drain(Buffer.concat([
      framedMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      framedMessage({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      framedMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    ]));

    expect(responses).toHaveLength(2);
    expect(responses.map((response) => (response as { id: number }).id)).toEqual([1, 2]);
    expect(JSON.stringify(responses[1])).toContain("kiwi_plan");
  });

  it("plans, generates P1 artifacts, and reads parity resources", async () => {
    const cwd = setupRepo();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { ticket: "# MCP Feature\n\n## Validate" },
        },
      },
      cwd,
    );
    expect(planned.error).toBeUndefined();
    const text = (planned.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { runId: string };
    expect(parsed.runId).toMatch(/^run_/);

    const runs = await handleMcpRequest(
      {
        id: 2,
        method: "resources/read",
        params: { uri: "kiwi://runs" },
      },
      cwd,
    );
    expect(runs.error).toBeUndefined();
    expect(JSON.stringify(runs.result)).toContain(parsed.runId);

    const initiative = await handleMcpRequest(
      {
        id: 3,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/initiative` },
      },
      cwd,
    );
    expect(initiative.error).toBeUndefined();
    expect(JSON.stringify(initiative.result)).toContain("MCP Feature");

    const plannerOutput = await handleMcpRequest(
      {
        id: 4,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/planner-output` },
      },
      cwd,
    );
    expect(plannerOutput.error).toBeUndefined();
    expect(JSON.stringify(plannerOutput.result)).toContain("stub-deterministic");

    const evidence = await handleMcpRequest(
      {
        id: 5,
        method: "tools/call",
        params: {
          name: "kiwi_evidence_manifest",
          arguments: { runId: parsed.runId },
        },
      },
      cwd,
    );
    expect(evidence.error).toBeUndefined();

    const snapshot = await handleMcpRequest(
      {
        id: 6,
        method: "tools/call",
        params: {
          name: "kiwi_operator_snapshot",
          arguments: { runId: parsed.runId },
        },
      },
      cwd,
    );
    expect(snapshot.error).toBeUndefined();

    const evidenceResource = await handleMcpRequest(
      {
        id: 7,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/evidence-manifest` },
      },
      cwd,
    );
    expect(evidenceResource.error).toBeUndefined();
    expect(JSON.stringify(evidenceResource.result)).toContain("final/audit-events.json");

    const snapshotResource = await handleMcpRequest(
      {
        id: 8,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/operator-snapshot` },
      },
      cwd,
    );
    expect(snapshotResource.error).toBeUndefined();
    expect(JSON.stringify(snapshotResource.result)).toContain("<!doctype html>");

    const a2a = await handleMcpRequest(
      {
        id: 9,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_receive",
          arguments: {
            loopback: true,
            trustedAgentIds: ["remote-agent"],
            envelope: {
              schemaVersion: "1",
              protocol: "a2a-prep",
              kind: "task_graph",
              payload: {
                planId: "plan_mcp",
                runId: parsed.runId,
                initiativeId: "init_mcp",
                summary: "MCP A2A graph",
                steps: [
                  {
                    stepId: "step_001",
                    type: "planning",
                    title: "Plan",
                    dependsOn: [],
                    successCriteria: ["Done"],
                    requiredGates: [],
                    recommendedAgentRole: "planner",
                    recommendedModelCapability: "frontier",
                    status: "pending",
                  },
                ],
                acceptanceCriteria: ["Done"],
                assumptions: [],
                openQuestions: [],
                riskScore: 2,
                complexityScore: 1,
                createdAt: "2026-05-04T12:00:00.000Z",
              },
              createdAt: "2026-05-04T12:00:00.000Z",
              a2a: {
                messageId: "msg_mcp",
                correlationId: "corr_mcp",
                idempotencyKey: "idempotency-mcp",
                senderAgentId: "remote-agent",
                recipientAgentId: "kiwi-local",
              },
            },
          },
        },
      },
      cwd,
    );
    expect(a2a.error).toBeUndefined();
    expect(JSON.stringify(a2a.result)).toContain("accepted");
  });

  it("accepts workspace selection and exposes kiwi_run", async () => {
    const workspace = setupWorkspace();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: {
            workspacePath: workspace.root,
            repoId: "voice-core",
            ticket: "# Workspace MCP\n\n## Implement",
          },
        },
      },
      os.tmpdir(),
    );
    expect(planned.error).toBeUndefined();
    const text = (planned.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { runId: string; repoPath: string };
    expect(parsed.repoPath).toBe(workspace.core);

    const run = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_run",
          arguments: {
            workspacePath: workspace.root,
            runId: parsed.runId,
            command: "node -e 0",
          },
        },
      },
      os.tmpdir(),
    );
    expect(run.error).toBeUndefined();
    expect(JSON.stringify(run.result)).toContain("completed");

    const worktrees = path.join(
      workspace.root,
      ".kiwi",
      "runs",
      parsed.runId,
      "worktrees",
    );
    const attemptDirs = readdirSync(worktrees);
    const worktree = path.join(worktrees, attemptDirs[0]!);
    expect(existsSync(path.join(worktree, "core.txt"))).toBe(true);
    expect(existsSync(path.join(worktree, "voice-livekit-agent"))).toBe(false);
  });

  it("exposes filesystem A2A trust, publish, sync, inbox, and accept tools", async () => {
    const a = setupRepo();
    const b = setupRepo();
    const enableA = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_config",
          arguments: { workspacePath: a, enabled: true, localAgentId: "agent-a" },
        },
      },
      os.tmpdir(),
    );
    const enableB = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_config",
          arguments: { workspacePath: b, enabled: true, localAgentId: "agent-b" },
        },
      },
      os.tmpdir(),
    );
    expect(enableA.error).toBeUndefined();
    expect(enableB.error).toBeUndefined();

    await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_trust_add",
          arguments: {
            workspacePath: a,
            agentId: "agent-b",
            inboxPath: path.join(b, ".kiwi", "a2a", "transport", "incoming"),
          },
        },
      },
      os.tmpdir(),
    );
    await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_trust_add",
          arguments: {
            workspacePath: b,
            agentId: "agent-a",
            inboxPath: path.join(a, ".kiwi", "a2a", "transport", "incoming"),
          },
        },
      },
      os.tmpdir(),
    );
    const peers = await handleMcpRequest(
      {
        id: 5,
        method: "tools/call",
        params: { name: "kiwi_a2a_trust_list", arguments: { workspacePath: a } },
      },
      os.tmpdir(),
    );
    expect(JSON.stringify(peers.result)).toContain("agent-b");

    const planned = await handleMcpRequest(
      {
        id: 6,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { workspacePath: a, ticket: "# MCP A2A\n\n## Implement" },
        },
      },
      os.tmpdir(),
    );
    const plannedJson = toolJson(planned) as { runId: string };
    const published = await handleMcpRequest(
      {
        id: 7,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_publish",
          arguments: {
            workspacePath: a,
            peerAgentId: "agent-b",
            kind: "initiative",
            runId: plannedJson.runId,
          },
        },
      },
      os.tmpdir(),
    );
    expect(published.error).toBeUndefined();

    await handleMcpRequest(
      {
        id: 8,
        method: "tools/call",
        params: { name: "kiwi_a2a_sync", arguments: { workspacePath: a } },
      },
      os.tmpdir(),
    );
    await handleMcpRequest(
      {
        id: 9,
        method: "tools/call",
        params: { name: "kiwi_a2a_sync", arguments: { workspacePath: b } },
      },
      os.tmpdir(),
    );
    const inbox = await handleMcpRequest(
      {
        id: 10,
        method: "tools/call",
        params: { name: "kiwi_a2a_inbox", arguments: { workspacePath: b } },
      },
      os.tmpdir(),
    );
    const inboxItems = toolJson(inbox) as Array<{ messageId: string; kind: string }>;
    expect(inboxItems[0]?.kind).toBe("initiative");

    const accepted = await handleMcpRequest(
      {
        id: 11,
        method: "tools/call",
        params: {
          name: "kiwi_a2a_accept",
          arguments: { workspacePath: b, messageId: inboxItems[0]?.messageId },
        },
      },
      os.tmpdir(),
    );
    expect(accepted.error).toBeUndefined();
    expect(JSON.stringify(accepted.result)).toContain("run_");
  });
});
