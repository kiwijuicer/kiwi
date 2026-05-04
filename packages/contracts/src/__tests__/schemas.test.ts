import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  ApprovalDecisionSchema,
  A2AConfigSchema,
  A2ARuntimeDecisionSchema,
  A2ARuntimeModeSchema,
  ArtifactSchema,
  AttemptSummarySchema,
  ContextPackageSchema,
  ContractsMetadataSchema,
  EvidenceManifestSchema,
  FinalCostReportSchema,
  FinalVerdictSchema,
  GateResultSchema,
  InitiativeSchema,
  KiwiConfigSchema,
  KiwiPolicySchema,
  ModelRegistrySchema,
  ProtocolEnvelopeSchema,
  ReviewVerdictSchema,
  RunAuditSnapshotSchema,
  RunnerExecutionOutputSchema,
  SchedulerDecisionSchema,
  RunSchema,
  StepAttemptSchema,
  TaskGraphSchema,
} from "../schemas";

describe("contracts schemas", () => {
  it("parses contracts metadata", () => {
    const parsed = ContractsMetadataSchema.parse({
      schemaVersion: "1",
      evolutionMode: "breaking_allowed",
    });
    expect(parsed.schemaVersion).toBe("1");
  });

  it("parses a minimal initiative", () => {
    const parsed = InitiativeSchema.parse({
      id: "init_demo",
      title: "Demo",
      rawInput: "demo input",
      source: "a2a",
      repoPath: "/tmp/repo",
      riskProfile: "dev",
      budgetProfile: "normal",
      createdAt: "2026-05-03T19:00:00.000Z",
    });

    expect(parsed.id).toBe("init_demo");
    expect(parsed.source).toBe("a2a");
  });

  it("parses a run manifest with canonical run schema", () => {
    const parsed = RunSchema.parse({
      runId: "run_demo",
      initiativeId: "init_demo",
      currentPlanId: "plan_demo",
      status: "planned",
      createdAt: "2026-05-03T19:00:00.000Z",
      updatedAt: "2026-05-03T19:00:00.000Z",
    });

    expect(parsed.runId).toBe("run_demo");
  });

  it("parses a valid task graph", () => {
    const parsed = TaskGraphSchema.parse({
      planId: "plan_demo",
      runId: "run_demo",
      initiativeId: "init_demo",
      summary: "Demo summary",
      acceptanceCriteria: ["Criteria 1"],
      assumptions: [],
      openQuestions: [],
      riskScore: 3,
      complexityScore: 2,
      createdAt: "2026-05-03T19:00:00.000Z",
      steps: [
        {
          stepId: "step_001",
          type: "planning",
          title: "Create plan",
          dependsOn: [],
          successCriteria: ["Plan is explicit"],
          requiredGates: [],
          recommendedAgentRole: "planner",
          recommendedModelCapability: "frontier",
          status: "pending",
        },
      ],
    });

    expect(parsed.steps).toHaveLength(1);
  });

  it("parses artifact, step attempt, gate result, and review verdict", () => {
    const artifact = ArtifactSchema.parse({
      type: "test_report",
      ref: "steps/step_001/attempt_001/artifacts/test-report.json",
      createdAt: "2026-05-03T19:00:00.000Z",
      metadata: { suite: "unit" },
    });

    const attempt = StepAttemptSchema.parse({
      attemptId: "attempt_001",
      stepId: "step_001",
      runner: "local-shell",
      agentRole: "executor",
      modelCapability: "strong",
      status: "completed",
      contextPackageRef: "steps/step_001/attempt_001/context-package.json",
      artifacts: [artifact],
      startedAt: "2026-05-03T19:00:00.000Z",
      completedAt: "2026-05-03T19:01:00.000Z",
    });

    const gate = GateResultSchema.parse({
      gateId: "gate_typecheck_001",
      gateType: "typecheck",
      status: "pass",
      evidenceRefs: ["steps/step_001/attempt_001/artifacts/typecheck-report.json"],
      reason: "No type errors",
    });

    const review = ReviewVerdictSchema.parse({
      verdict: "pass_with_comments",
      safeToContinue: true,
      issues: [
        {
          code: "NIT-001",
          title: "Minor naming cleanup",
          severity: "low",
        },
      ],
      recommendedNextSteps: ["Proceed to next step"],
      confidence: 0.86,
    });

    expect(attempt.artifacts).toHaveLength(1);
    expect(gate.status).toBe("pass");
    expect(review.verdict).toBe("pass_with_comments");
  });

  it("rejects invalid gate status", () => {
    const parsed = GateResultSchema.safeParse({
      gateId: "gate_1",
      gateType: "typecheck",
      status: "ok",
      evidenceRefs: [],
      reason: "invalid",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid review confidence", () => {
    const parsed = ReviewVerdictSchema.safeParse({
      verdict: "pass",
      safeToContinue: true,
      issues: [],
      recommendedNextSteps: [],
      confidence: 2,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid step attempt runner", () => {
    const parsed = StepAttemptSchema.safeParse({
      attemptId: "attempt_001",
      stepId: "step_001",
      runner: "unknown-runner",
      agentRole: "executor",
      modelCapability: "strong",
      status: "running",
      contextPackageRef: "ctx.json",
      artifacts: [],
      startedAt: "2026-05-03T19:00:00.000Z",
      completedAt: null,
    });

    expect(parsed.success).toBe(false);
  });

  it("parses policy and registry", () => {
    const policy = KiwiPolicySchema.parse({
      version: "1",
      project: {
        name: "ai-kiwi",
        language: "typescript",
        packageManager: "pnpm",
      },
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        typecheck: "pnpm typecheck",
      },
      routing: {
        defaultAgentRole: "executor",
        defaultModelCapability: "mid",
        stepTypeOverrides: {},
      },
      riskZones: { high: [] },
      approvals: { requireFor: [] },
    });

    const registry = ModelRegistrySchema.parse({
      version: "1",
      models: [
        {
          id: "stub-mid",
          provider: "stub",
          capability: "mid",
          roles: ["executor"],
          enabled: true,
        },
      ],
    });

    expect(policy.version).toBe("1");
    expect(policy.commandProfiles.default).toBeUndefined();
    expect(registry.models[0]?.id).toBe("stub-mid");
  });

  it("parses operator, finalization, and protocol boundary contracts", () => {
    const contextPackage = ContextPackageSchema.parse({
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      level: "L1",
      include: {
        initiative: true,
        policy: true,
        registry: true,
        commands: true,
        relevantFiles: ["src/index.ts"],
        tests: ["src/index.test.ts"],
        recentDiffFiles: [],
        symbolHits: [],
        traces: [],
        architectureFiles: ["docs/architecture.md"],
        historicalOutcomeRefs: [],
      },
      generatedAt: "2026-05-04T08:00:00.000Z",
    });
    const decision = SchedulerDecisionSchema.parse({
      status: "scheduled",
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "executor",
      modelCapability: "strong",
      runner: "local-shell",
      contextLevel: "L1",
      reviewDepth: "strong",
      requiredGates: ["tests"],
      contextPackageRef: "steps/step_001/attempt_001/context-package.json",
    });
    const output = RunnerExecutionOutputSchema.parse({
      status: "completed",
      artifactRefs: [],
      rawLogsRef: null,
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      gateResult: {
        gateId: "gate_tests",
        gateType: "tests",
        status: "pass",
        evidenceRefs: [],
        reason: "ok",
      },
    });
    const summary = AttemptSummarySchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      status: "completed",
      runnerStatus: "completed",
      nextAction: {
        type: "continue",
        reason: "pass",
        recommendedNextSteps: ["Continue"],
        issueCodes: [],
      },
      gateResultsRef: "steps/step_001/attempt_001/gate-results.json",
      reviewReportRef: "steps/step_001/attempt_001/artifacts/review-report.json",
      costReportRef: "steps/step_001/attempt_001/artifacts/cost-report.json",
      artifactRefs: [],
      completedAt: "2026-05-04T08:00:00.000Z",
    });
    const finalVerdict = FinalVerdictSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      verdict: "pass",
      safeToApply: true,
      completedStepIds: ["step_001"],
      failedStepIds: [],
      blockedStepIds: [],
      missingStepIds: [],
      gateResultRefs: [],
      reviewReportRefs: [],
      reason: "done",
      createdAt: "2026-05-04T08:00:00.000Z",
    });
    const cost = FinalCostReportSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      plannerCostUsd: 0,
      runnerCostUsd: 0,
      totalEstimatedUsd: 0,
      currency: "USD",
      createdAt: "2026-05-04T08:00:00.000Z",
    });
    const approval = ApprovalDecisionSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      attemptId: "attempt_001",
      state: "auto",
      reason: "ok",
      approvedBy: "operator",
      createdAt: "2026-05-04T08:00:00.000Z",
    });
    const auditSnapshot = RunAuditSnapshotSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      eventCount: 1,
      events: [
        {
          eventType: "run_finalized",
          runId: "run_demo",
          timestamp: "2026-05-04T08:00:00.000Z",
          payload: { verdict: "pass" },
        },
      ],
      createdAt: "2026-05-04T08:00:00.000Z",
    });
    const evidence = EvidenceManifestSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      generatedAt: "2026-05-04T08:00:00.000Z",
      auditSnapshotRef: "final/audit-events.json",
      files: [
        {
          ref: "run.json",
          sha256: "a".repeat(64),
          bytes: 42,
        },
      ],
    });
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, "..", "__fixtures__", "a2a-envelope.json"), "utf-8"),
    ) as unknown;
    const envelope = ProtocolEnvelopeSchema.parse(fixture);
    const envelopeWithAttachment = ProtocolEnvelopeSchema.parse({
      schemaVersion: "1",
      protocol: "a2a-prep",
      kind: "artifact",
      payload: {
        type: "diff",
        ref: "steps/step_001/attempt_001/artifacts/diff.patch",
        createdAt: "2026-05-04T08:00:00.000Z",
      },
      createdAt: "2026-05-04T08:00:00.000Z",
      a2a: {
        messageId: "msg_attachment",
        correlationId: "corr_attachment",
        idempotencyKey: "attachment-key",
        senderAgentId: "agent-a",
        recipientAgentId: "agent-b",
        attachments: [
          {
            ref: "attachments/msg_attachment/diff.patch",
            sha256: "a".repeat(64),
            bytes: 12,
            mediaType: "text/x-patch",
          },
        ],
      },
    });
    const a2aConfig = A2AConfigSchema.parse({
      enabled: true,
      localAgentId: "agent-a",
      acceptedKinds: ["initiative", "task_graph"],
      peers: [{ agentId: "agent-b", inboxPath: "/tmp/b/.kiwi/a2a/transport/incoming" }],
    });
    const kiwiConfig = KiwiConfigSchema.parse({ version: "1" });
    const mode = A2ARuntimeModeSchema.parse("filesystem");
    const a2aDecision = A2ARuntimeDecisionSchema.parse({
      schemaVersion: "1",
      status: "accepted",
      reason: "accepted",
      messageId: "msg_demo",
      correlationId: "corr_demo",
      runId: "run_demo",
      inboxRef: "inbox/msg_demo.json",
      createdAt: "2026-05-04T08:00:00.000Z",
    });

    expect(contextPackage.level).toBe("L1");
    expect(decision.runner).toBe("local-shell");
    expect(output.status).toBe("completed");
    expect(summary.nextAction.type).toBe("continue");
    expect(finalVerdict.safeToApply).toBe(true);
    expect(cost.currency).toBe("USD");
    expect(approval.state).toBe("auto");
    expect(auditSnapshot.eventCount).toBe(1);
    expect(evidence.files[0]?.ref).toBe("run.json");
    expect(envelope.protocol).toBe("a2a-prep");
    expect(envelopeWithAttachment.a2a?.attachments?.[0]?.mediaType).toBe("text/x-patch");
    expect(a2aConfig.peers[0]?.allowRemotePatches).toBe(false);
    expect(kiwiConfig.a2a.enabled).toBe(false);
    expect(mode).toBe("filesystem");
    expect(a2aDecision.status).toBe("accepted");
  });
});
