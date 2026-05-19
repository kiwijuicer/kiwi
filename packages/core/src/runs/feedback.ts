import { existsSync, readdirSync } from "fs";
import path from "path";
import { RunFeedback, RunFeedbackSchema } from "@kiwi/contracts";
import { generateFeedbackId } from "../ids";
import { appendAuditEvent } from "../ledger/cost-ledger";
import { readJson, writeJsonSafely } from "../storage/json-io";
import { ensureRunLayout, resolveRunArtifactPath } from "./store";

export interface RecordRunFeedbackInput {
  cwd: string;
  runId: string;
  message: string;
  source: RunFeedback["source"];
  author?: string;
  targetStepId?: string;
  targetAttemptId?: string;
  evidenceRefs?: string[];
  now?: Date;
}

export function recordRunFeedback(input: RecordRunFeedbackInput): { feedback: RunFeedback; ref: string } {
  ensureRunLayout(input.runId, input.cwd);
  const now = input.now ?? new Date();
  const feedbackInput: Record<string, unknown> = {
    schemaVersion: "1",
    feedbackId: generateFeedbackId(now),
    runId: input.runId,
    message: input.message,
    source: input.source,
    evidenceRefs: input.evidenceRefs ?? [],
    createdAt: now.toISOString(),
  };

  if (input.author) {
    feedbackInput.author = input.author;
  }
  if (input.targetStepId) {
    feedbackInput.targetStepId = input.targetStepId;
  }
  if (input.targetAttemptId) {
    feedbackInput.targetAttemptId = input.targetAttemptId;
  }
  const feedback = RunFeedbackSchema.parse(feedbackInput);
  const ref = `feedback/${feedback.feedbackId}.json`;
  writeJsonSafely(resolveRunArtifactPath(input.runId, ref, input.cwd), feedback);
  appendAuditEvent(input.cwd, {
    eventType: "feedback_recorded",
    runId: input.runId,
    timestamp: feedback.createdAt,
    payload: {
      feedbackId: feedback.feedbackId,
      source: feedback.source,
      author: feedback.author ?? null,
      targetStepId: feedback.targetStepId ?? null,
      targetAttemptId: feedback.targetAttemptId ?? null,
      evidenceRefs: feedback.evidenceRefs,
    },
  });

  return { feedback, ref };
}

export function listRunFeedback(cwd: string, runId: string): RunFeedback[] {
  const dir = resolveRunArtifactPath(runId, "feedback", cwd);

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => RunFeedbackSchema.parse(readJson(path.join(dir, entry))))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
