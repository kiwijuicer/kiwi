import { appendAuditEvent } from "@kiwi/core";
import type { ExecutorSelection } from "../../registries/runner-registry";

export class ExecutionAuditReporter {
  executorModelSelected(params: {
    cwd: string;
    runId: string;
    stepId: string;
    attemptId: string;
    runner: string;
    selection: ExecutorSelection;
    now: Date;
  }): void {
    appendAuditEvent(params.cwd, {
      eventType: "executor_model_selected",
      runId: params.runId,
      timestamp: params.now.toISOString(),
      payload: {
        stepId: params.stepId,
        attemptId: params.attemptId,
        runner: params.runner,
        requestedCapability: params.selection.requestedCapability,
        selectedCapability: params.selection.selectedCapability,
        modelId: params.selection.model?.id ?? null,
        providerName: params.selection.model?.provider ?? null,
        accessMode: params.selection.model?.accessMode ?? null,
        reason: params.selection.reason,
      },
    });
  }

  providerPreferenceApplied(params: {
    cwd: string;
    runId: string;
    stepId: string;
    attemptId: string;
    role: string;
    selectedAccessMode: string | null;
    selectedModelId: string | null;
    preference: string[];
    now: Date;
  }): void {
    if (params.preference.length === 0) {
      return;
    }
    appendAuditEvent(params.cwd, {
      eventType: "provider_preference_applied",
      runId: params.runId,
      timestamp: params.now.toISOString(),
      payload: {
        stepId: params.stepId,
        attemptId: params.attemptId,
        role: params.role,
        selectedAccessMode: params.selectedAccessMode,
        selectedModelId: params.selectedModelId,
        preference: params.preference,
      },
    });
  }
}
