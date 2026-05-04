import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { ProtocolEnvelope } from "@ai-kiwi/contracts";
import { readAuditEvents } from "../cost-ledger";
import { handleA2AEnvelope } from "../a2a-runtime";

function cwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-a2a-"));
}

function taskGraphEnvelope(overrides: Partial<ProtocolEnvelope["a2a"]> = {}): ProtocolEnvelope {
  return {
    schemaVersion: "1",
    protocol: "a2a-prep",
    kind: "task_graph",
    payload: {
      planId: "plan_demo",
      runId: "run_demo",
      initiativeId: "init_demo",
      summary: "Remote graph",
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
      messageId: "msg_demo",
      correlationId: "corr_demo",
      idempotencyKey: "idempotency-demo",
      senderAgentId: "remote-agent",
      recipientAgentId: "ai-kiwi-local",
      ...overrides,
    },
  };
}

describe("A2A runtime", () => {
  it("is disabled by default", () => {
    const repo = cwd();
    const result = handleA2AEnvelope({
      cwd: repo,
      envelope: taskGraphEnvelope(),
      now: new Date("2026-05-04T12:01:00.000Z"),
    });

    expect(result.decision.status).toBe("blocked");
    expect(result.decision.reason).toContain("disabled");
    expect(existsSync(path.join(repo, ".kiwi", "a2a", "inbox", "msg_demo.json"))).toBe(false);
  });

  it("accepts trusted loopback envelopes once and detects replays", () => {
    const repo = cwd();
    const envelope = taskGraphEnvelope();

    const accepted = handleA2AEnvelope({
      cwd: repo,
      envelope,
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:02:00.000Z"),
    });
    expect(accepted.decision.status).toBe("accepted");
    expect(accepted.decision.runId).toBe("run_demo");
    expect(existsSync(path.join(repo, ".kiwi", "a2a", "inbox", "msg_demo.json"))).toBe(true);

    const duplicate = handleA2AEnvelope({
      cwd: repo,
      envelope,
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:03:00.000Z"),
    });
    expect(duplicate.decision.status).toBe("duplicate");
    expect(duplicate.decision.duplicateOfRef).toContain("idempotency");

    const events = readAuditEvents(repo, "run_demo");
    expect(events.some((event) => event.eventType === "a2a_runtime_event")).toBe(true);
  });

  it("blocks untrusted senders and remote patch artifacts", () => {
    const repo = cwd();
    const untrusted = handleA2AEnvelope({
      cwd: repo,
      envelope: taskGraphEnvelope({ senderAgentId: "unknown-agent" }),
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:04:00.000Z"),
    });
    expect(untrusted.decision.status).toBe("blocked");
    expect(untrusted.decision.reason).toContain("not trusted");

    const patchEnvelope: ProtocolEnvelope = {
      schemaVersion: "1",
      protocol: "a2a-prep",
      kind: "artifact",
      payload: {
        type: "patch",
        ref: "remote.patch",
        createdAt: "2026-05-04T12:00:00.000Z",
      },
      createdAt: "2026-05-04T12:00:00.000Z",
      a2a: {
        messageId: "msg_patch",
        correlationId: "corr_patch",
        idempotencyKey: "idempotency-patch",
        senderAgentId: "remote-agent",
        recipientAgentId: "ai-kiwi-local",
      },
    };
    const patch = handleA2AEnvelope({
      cwd: repo,
      envelope: patchEnvelope,
      policy: {
        mode: "loopback",
        trustedAgentIds: ["remote-agent"],
      },
      now: new Date("2026-05-04T12:05:00.000Z"),
    });
    expect(patch.decision.status).toBe("blocked");
    expect(patch.decision.reason).toContain("Remote patch");
  });
});
