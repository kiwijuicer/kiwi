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
  BudgetProfileLimitSchema,
  ContextPackageSchema,
  ContractsMetadataSchema,
  EvidenceManifestSchema,
  FinalCostReportSchema,
  FinalVerdictSchema,
  GateResultSchema,
  InitiativeSchema,
  KiwiConfigSchema,
  KiwiPolicySchema,
  ModelInvocationRecordSchema,
  ModelRegistrySchema,
  ModelUsageSummarySchema,
  PrDraftArtifactSchema,
  ProtocolEnvelopeSchema,
  ReviewVerdictSchema,
  RunAuditSnapshotSchema,
  RunCompletionSummarySchema,
  RunnerExecutionOutputSchema,
  SchedulerDecisionSchema,
  ScmMutationResultSchema,
  ScmPullRequestDraftSchema,
  ScmPullRequestReviewDraftSchema,
  ScmRepositoryRefSchema,
  ScmTicketDraftSchema,
  RunSchema,
  StepAttemptSchema,
  SubPlanSchema,
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
      subPlans: [
        {
          subPlanId: "subplan_wave_1",
          title: "Wave 1",
          stepIds: ["step_001"],
          maxConcurrency: 1,
        },
      ],
    });

    expect(parsed.steps).toHaveLength(1);
    expect(parsed.subPlans?.[0]?.stepIds).toEqual(["step_001"]);
    expect(
      SubPlanSchema.parse({ subPlanId: "subplan_demo", title: "Demo", stepIds: ["step_001"] }).maxConcurrency,
    ).toBe(1);
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
      subject: {
        type: "diff",
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
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
      subject: {
        type: "diff",
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    expect(attempt.artifacts).toHaveLength(1);
    expect(gate.status).toBe("pass");
    expect(review.verdict).toBe("pass_with_comments");
    expect(review.subject?.hash).toBe("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("parses PR draft artifacts without credentials", () => {
    const draft = PrDraftArtifactSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      repository: {
        provider: "bitbucket-cloud",
        workspace: "kiwi",
        repoSlug: "core",
        remoteUrl: "git@bitbucket.org:kiwi/core.git",
      },
      remote: "origin",
      sourceBranch: "kiwi/run_demo",
      targetBranch: "main",
      title: "Demo PR",
      description: "Evidence only, no credentials",
      createUrl: "https://bitbucket.org/kiwi/core/pull-requests/new?source=kiwi%2Frun_demo&dest=main",
      evidenceRefs: ["final/evidence-manifest.json"],
      diffHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      createdAt: "2026-05-05T08:00:00.000Z",
    });

    expect(draft.repository.provider).toBe("bitbucket-cloud");
    expect(JSON.stringify(draft)).not.toContain("token");
  });

  it("parses model invocation records and usage summaries", () => {
    const invocation = ModelInvocationRecordSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      phase: "planner",
      agentRole: "planner",
      requestedCapability: "frontier",
      selectedCapability: "frontier",
      modelId: "stub-frontier",
      providerName: "stub-deterministic",
      runner: null,
      accessMode: "stub",
      usage: { inputTokens: 12, outputTokens: 34 },
      estimatedCostUsd: 0,
      status: "completed",
      evidenceRefs: ["plan/planner-output.json"],
      startedAt: "2026-05-04T08:00:00.000Z",
      completedAt: "2026-05-04T08:00:01.000Z",
    });
    const summary = ModelUsageSummarySchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      invocationCount: 1,
      totals: { inputTokens: 12, outputTokens: 34, estimatedCostUsd: 0 },
      byPhase: {
        planner: { inputTokens: 12, outputTokens: 34, estimatedCostUsd: 0 },
        executor: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        reviewer: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      },
      invocations: [invocation],
      generatedAt: "2026-05-04T08:00:02.000Z",
    });

    expect(summary.invocations[0]?.modelId).toBe("stub-frontier");
    expect(summary.invocations[0]?.accessMode).toBe("stub");
    expect(summary.totals.outputTokens).toBe(34);
  });

  it("parses budget limits, final cost reports, scheduler reasons, and run completion summaries", () => {
    const budget = BudgetProfileLimitSchema.parse({
      profile: "tiny",
      softCapUsd: 0.25,
      hardCapUsd: 0.5,
    });
    expect(budget.hardCapUsd).toBe(0.5);

    const scheduler = SchedulerDecisionSchema.parse({
      status: "scheduled",
      runId: "run_demo",
      stepId: "step_001",
      attemptId: "attempt_001",
      agentRole: "executor",
      modelCapability: "mid",
      runner: "codex",
      contextLevel: "L1",
      reviewDepth: "strong",
      requiredGates: ["tests"],
      routingReason: ["budget_constrained_downgrade"],
      budget: { profile: "tiny", softCapUsd: 0.25, hardCapUsd: 0.5, remainingUsdEstimate: 0.2 },
      contextPackageRef: "steps/step_001/attempt_001/context-package.json",
    });
    expect(scheduler.routingReason).toContain("budget_constrained_downgrade");

    const cost = FinalCostReportSchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      plannerCostUsd: 0.1,
      executorCostUsd: 0.2,
      reviewerCostUsd: 0.3,
      runnerCostUsd: 0.5,
      totalEstimatedUsd: 0.6,
      usagePrecision: { exact: 1, estimated: 2, unknown: 0 },
      models: [
        {
          phase: "executor",
          selectedCapability: "strong",
          modelId: "codex-cli-auto",
          providerName: "local",
          runner: "codex",
          accessMode: "codex-cli",
        },
      ],
      currency: "USD",
      createdAt: "2026-05-04T08:00:02.000Z",
    });
    expect(cost.reviewerCostUsd).toBe(0.3);

    const completion = RunCompletionSummarySchema.parse({
      schemaVersion: "1",
      runId: "run_demo",
      status: "completed",
      totalEstimatedCostUsd: 0.6,
      currency: "USD",
      usagePrecision: { exact: 1, estimated: 2, unknown: 0 },
      phaseCostsUsd: { planner: 0.1, executor: 0.2, reviewer: 0.3 },
      phaseSummaries: {
        planner: {
          phase: "planner",
          costUsd: 0.1,
          invocations: 1,
          usagePrecision: { exact: 0, estimated: 1, unknown: 0 },
          models: ["frontier/stub"],
          accessModes: ["stub"],
        },
        executor: {
          phase: "executor",
          costUsd: 0.2,
          invocations: 1,
          usagePrecision: { exact: 1, estimated: 0, unknown: 0 },
          models: ["strong/codex-cli"],
          accessModes: ["codex-cli"],
        },
        reviewer: {
          phase: "reviewer",
          costUsd: 0.3,
          invocations: 1,
          usagePrecision: { exact: 0, estimated: 1, unknown: 0 },
          models: ["frontier/claude-code-cli"],
          accessModes: ["claude-code-cli"],
        },
      },
      attempts: { total: 1, completed: 1, failed: 0, blocked: 0 },
      failedStepIds: [],
      blockedStepIds: [],
      finalVerdict: "pass",
      safeToApply: true,
      nextAction: "complete",
      compact: "cost: $0.60 estimated · verdict: pass",
      generatedAt: "2026-05-04T08:00:03.000Z",
    });
    expect(completion.nextAction).toBe("complete");
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

  it("parses SCM contracts with external auth boundary", () => {
    const repository = ScmRepositoryRefSchema.parse({
      provider: "bitbucket-cloud",
      workspace: "kiwi",
      repoSlug: "kiwi",
      remoteUrl: "https://bitbucket.org/kiwi/kiwi",
    });
    const ticket = ScmTicketDraftSchema.parse({
      repository,
      title: "Refactor runner adapter",
      body: "Keep credentials outside Kiwi.",
    });
    const pullRequest = ScmPullRequestDraftSchema.parse({
      repository,
      title: "Implement adapter",
      sourceBranch: "feature/adapter",
      destinationBranch: "main",
    });
    const review = ScmPullRequestReviewDraftSchema.parse({
      repository,
      pullRequestId: 42,
      summary: "Needs one small fix.",
      comments: [
        {
          body: "Please add a regression test.",
          filePath: "src/index.ts",
          line: 12,
          createTask: true,
        },
      ],
      requestChanges: true,
    });
    const result = ScmMutationResultSchema.parse({
      provider: "bitbucket-cloud",
      authMode: "external",
      status: "created",
      externalId: "42",
      externalUrl: "https://bitbucket.org/kiwi/kiwi/pull-requests/42",
    });

    expect(ticket.repository.provider).toBe("bitbucket-cloud");
    expect(pullRequest.closeSourceBranch).toBe(false);
    expect(review.comments[0]?.createTask).toBe(true);
    expect(result.authMode).toBe("external");
  });

  it("rejects incomplete Bitbucket repository refs", () => {
    const parsed = ScmRepositoryRefSchema.safeParse({
      provider: "bitbucket-cloud",
      workspace: "kiwi",
    });

    expect(parsed.success).toBe(false);
  });

  it("parses policy and registry", () => {
    const policy = KiwiPolicySchema.parse({
      version: "1",
      project: {
        name: "kiwi",
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
          accessMode: "stub",
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
