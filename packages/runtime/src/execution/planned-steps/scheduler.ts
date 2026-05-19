import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import type { CoreServices } from "@kiwi/core";
import {
  RiskProfiles,
  RunnerNames,
  SchedulerDecisionStatuses,
  StepTypes,
  type Initiative,
  type KiwiPolicy,
  type ModelEntry,
  type Step,
} from "@kiwi/contracts";
import type { SchedulerDecision, SchedulerPolicyService } from "../../policies/scheduler-policy";
import {
  BlastRadii,
  ContextSizes,
  SecuritySensitivities,
  type BlastRadius,
  type ContextSize,
  type SecuritySensitivity,
} from "../../policies/scheduler-types";
import { ExecutionPolicyResolver } from "./policy";
import type { StepExecutionSession } from "./session";
import type { ExecutionMode } from "./types";

export class SchedulerDecisionService {
  constructor(
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly schedulerPolicy: SchedulerPolicyService,
    private readonly core: CoreServices,
  ) {}

  schedule(session: StepExecutionSession): SchedulerDecision {
    const decision = this.schedulerPolicy.scheduleStepAttempt({
      ...this.decisionInput(session),
      now: session.now,
      ...(session.input.attemptId ? { attemptId: session.input.attemptId } : {}),
    });

    if (decision.status !== SchedulerDecisionStatuses.Scheduled) {
      throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
    }
    if (!decision.runner) {
      throw new Error("Scheduler selected no runner");
    }
    session.setDecision(decision);

    return decision;
  }

  previewStepDecision(session: StepExecutionSession): SchedulerDecision {
    if (!session.input.attemptId) {
      throw new Error("Preview scheduler decision requires an attempt id");
    }

    return this.schedulerPolicy.previewStepAttempt({
      ...this.decisionInput(session),
      attemptId: session.input.attemptId,
      now: session.now,
    });
  }

  enrich(session: StepExecutionSession, isolation: ExecutionMode): SchedulerDecision {
    const enriched = this.enrichedDecision({
      cwd: session.cwd,
      decision: session.decision,
      policy: session.context.policy,
      selectedModel: session.runnerSelection.selectedModel,
      selectedModelId: session.runnerSelection.selectedModelId,
      executorSelectionReason: session.runnerSelection.executorSelectionReason,
      isolation,
    });
    session.setEnrichedDecision(enriched);

    return enriched;
  }

  private enrichedDecision(params: {
    cwd: string;
    decision: SchedulerDecision;
    policy: KiwiPolicy;
    selectedModel: ModelEntry | null;
    selectedModelId: string | null;
    executorSelectionReason: string | null;
    isolation: ExecutionMode;
  }): SchedulerDecision {
    const enriched: SchedulerDecision = {
      ...params.decision,
      selectedModelId: params.selectedModelId,
      selectedProviderModel: params.selectedModel?.providerModel ?? null,
      selectedAccessMode: params.selectedModel?.accessMode ?? null,
      executorSelectionReason: params.executorSelectionReason,
      ...(params.selectedModel
        ? {
            estimatedAttemptCostUsd: this.core.budgets.estimateAttemptCostUsd({
              model: params.selectedModel,
              capability: params.decision.modelCapability,
              contextLevel: params.decision.contextLevel,
            }),
          }
        : {}),
      executionOwner: this.policyResolver.executionOwner(params.policy),
      executionIsolation: params.isolation,
    };
    this.schedulerPolicy.saveSchedulerDecision(params.cwd, enriched);
    this.saveEnrichedContextPackage(params.cwd, enriched);

    return enriched;
  }

  private saveEnrichedContextPackage(cwd: string, decision: SchedulerDecision): void {
    const contextPackage = this.schedulerPolicy.loadContextPackage({
      cwd,
      runId: decision.runId,
      stepId: decision.stepId,
      attemptId: decision.attemptId,
    });
    this.schedulerPolicy.saveContextPackage(cwd, {
      ...contextPackage,
      budget: {
        modelCapability: decision.modelCapability,
        contextLevel: decision.contextLevel,
        selectedModelId: decision.selectedModelId ?? null,
        selectedProviderModel: decision.selectedProviderModel ?? null,
        estimatedAttemptCostUsd: decision.estimatedAttemptCostUsd ?? null,
      },
    });
  }

  private decisionInput(session: StepExecutionSession) {
    const relevantFiles = this.relevantFilesFor(session);
    const risk = this.riskFor(session.context.initiative, session.context.policy, session.step, relevantFiles);

    return {
      cwd: session.cwd,
      runId: session.runId,
      step: session.step,
      initiative: session.context.initiative,
      taskGraph: session.context.taskGraph,
      policy: session.context.policy,
      budgetProfile: session.context.initiative.budgetProfile,
      budgetRemainingUsdEstimate: this.core.budgets.remainingUsdEstimate({
        cwd: session.cwd,
        runId: session.runId,
        budgetProfile: session.context.initiative.budgetProfile,
      }),
      blastRadius: risk.blastRadius,
      securitySensitivity: risk.securitySensitivity,
      contextSize: risk.contextSize,
      runnerAvailability: session.isResearchStep
        ? [RunnerNames.Api]
        : (session.runnerResolution?.runnerAvailability ?? []),
      explicitCommand: Boolean(session.input.command?.length),
      relevantFiles,
      testFiles: this.testFilesFor(relevantFiles),
      recentDiffFiles: this.gitChangedFiles(session.context.repoPath),
      architectureFiles: this.architectureFilesFor(session.context.repoPath),
    };
  }

  private riskFor(
    initiative: Initiative,
    policy: KiwiPolicy,
    step: Step,
    relevantFiles: string[],
  ): {
    blastRadius: BlastRadius;
    securitySensitivity: SecuritySensitivity;
    contextSize: ContextSize;
  } {
    const text = `${initiative.rawInput}\n${step.title}`.toLowerCase();
    const riskZonePatterns = policy.riskZones.high;
    const touchesRiskZone = relevantFiles.some((file) =>
      riskZonePatterns.some((pattern) => this.pathMatches(file, pattern)),
    );
    const sensitiveText = /\b(auth|payment|secret|token|credential|migration|infra|workflow|deploy)\b/.test(text);
    const highRisk = initiative.riskProfile === RiskProfiles.Production || touchesRiskZone || sensitiveText;
    const broadContext = relevantFiles.length > 8 || step.type === StepTypes.Refactoring;

    return {
      blastRadius: highRisk ? BlastRadii.High : BlastRadii.Low,
      securitySensitivity: highRisk ? SecuritySensitivities.High : SecuritySensitivities.Low,
      contextSize: highRisk || broadContext ? ContextSizes.Large : relevantFiles.length > 2 ? ContextSizes.Medium : ContextSizes.Small,
    };
  }

  private relevantFilesFor(session: StepExecutionSession): string[] {
    const mentioned = this.filesMentionedIn(`${session.context.initiative.rawInput}\n${session.step.title}`);
    const changed = this.gitChangedFiles(session.context.repoPath);

    return Array.from(new Set([...mentioned, ...changed])).slice(0, 24);
  }

  private filesMentionedIn(text: string): string[] {
    return Array.from(text.matchAll(/(?:^|\s)([A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+)(?=\s|$|[,.;:])/g))
      .map((match) => match[1])
      .filter((entry): entry is string => Boolean(entry && !entry.startsWith("http")));
  }

  private gitChangedFiles(repoPath: string): string[] {
    try {
      const output = execFileSync("git", ["-C", repoPath, "diff", "--name-only"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      return output
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 24);
    } catch {
      return [];
    }
  }

  private testFilesFor(relevantFiles: string[]): string[] {
    return relevantFiles
      .flatMap((file) => {
        const base = file.replace(/^src\//, "").replace(/\.[^.]+$/, "");

        return [`tests/${base}.test.ts`, `src/${base}.test.ts`];
      })
      .slice(0, 12);
  }

  private architectureFilesFor(repoPath: string): string[] {
    const candidates = ["AGENTS.md", "docs/vision.md", "docs/architecture.md", "docs/rules/architecture.md"];

    return candidates.filter((file) => existsSync(path.join(repoPath, file)));
  }

  private pathMatches(filePath: string, pattern: string): boolean {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");

    return new RegExp(`^${escaped}$`).test(filePath);
  }
}
