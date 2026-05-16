import { createHash, randomBytes } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import {
  appendAuditEvent,
  kiwiPolicyPath,
  loadInitiative,
  loadTaskGraph,
  readJson,
  resolveRunArtifactPath,
  writeJsonSafely,
} from "@kiwi/core";
import { RunExecutionPreview } from "@kiwi/runtime";
import { readRepoState } from "./repo-state";
import { ToolActionRequiredError } from "./tool-errors";

export interface McpPreviewInput {
  fromStep: string | null;
  maxConcurrency: number;
}

interface McpPreviewFingerprints {
  taskGraphHash: string;
  policyHash: string;
  repoHead: string | null;
  dirtyStateHash: string;
}

export interface McpPreviewTokenRecord {
  schemaVersion: "1";
  token: string;
  runId: string;
  workspacePath: string;
  repoPath: string;
  createdAt: string;
  previewInput: McpPreviewInput;
  fingerprints: McpPreviewFingerprints;
  stateHash: string;
  previewStepIds: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePreviewInput(args: {
  fromStep?: string | undefined;
  maxConcurrency?: number | undefined;
}): McpPreviewInput {
  return {
    fromStep: args.fromStep ?? null,
    maxConcurrency: args.maxConcurrency ?? 2,
  };
}

function previewPath(cwd: string, runId: string, token: string): string {
  if (!/^preview_[a-f0-9_]+$/.test(token)) {
    throw new ToolActionRequiredError("Invalid previewToken", {
      nextTool: "kiwi_preview_run",
      reason: "preview token format is invalid",
    });
  }
  return resolveRunArtifactPath(runId, `previews/${token}.json`, cwd);
}

function hashPolicy(cwd: string): string {
  const target = kiwiPolicyPath(cwd);
  return existsSync(target) ? sha256(readFileSync(target, "utf-8")) : sha256("missing-policy");
}

function fingerprintState(cwd: string, runId: string): { repoPath: string; fingerprints: McpPreviewFingerprints } {
  const initiative = loadInitiative(runId, cwd);
  const repoPath = initiative.repoPath || cwd;
  const repoState = readRepoState(repoPath);
  return {
    repoPath,
    fingerprints: {
      taskGraphHash: sha256(JSON.stringify(loadTaskGraph(runId, cwd))),
      policyHash: hashPolicy(cwd),
      repoHead: repoState.head,
      dirtyStateHash: repoState.dirtyStateHash,
    },
  };
}

function stateHash(fingerprints: McpPreviewFingerprints, previewInput: McpPreviewInput): string {
  return sha256(JSON.stringify({ fingerprints, previewInput }));
}

export function createMcpPreviewToken(params: {
  cwd: string;
  runId: string;
  preview: RunExecutionPreview;
  previewInput: McpPreviewInput;
  now?: Date;
}): McpPreviewTokenRecord {
  const { repoPath, fingerprints } = fingerprintState(params.cwd, params.runId);
  const hash = stateHash(fingerprints, params.previewInput);
  const token = `preview_${hash.slice(0, 16)}_${randomBytes(8).toString("hex")}`;
  const record: McpPreviewTokenRecord = {
    schemaVersion: "1",
    token,
    runId: params.runId,
    workspacePath: params.cwd,
    repoPath,
    createdAt: (params.now ?? new Date()).toISOString(),
    previewInput: params.previewInput,
    fingerprints,
    stateHash: hash,
    previewStepIds: params.preview.steps.map((step) => step.stepId),
  };
  writeJsonSafely(previewPath(params.cwd, params.runId, token), record);
  appendAuditEvent(params.cwd, {
    eventType: "mcp_preview_created",
    runId: params.runId,
    timestamp: record.createdAt,
    payload: {
      token,
      stateHash: hash,
      fromStep: params.previewInput.fromStep,
      maxConcurrency: params.previewInput.maxConcurrency,
      stepIds: record.previewStepIds,
    },
  });
  return record;
}

function loadPreviewRecord(cwd: string, runId: string, token: string): McpPreviewTokenRecord {
  const target = previewPath(cwd, runId, token);
  if (!existsSync(target)) {
    throw new ToolActionRequiredError("kiwi_run requires a valid previewToken from kiwi_preview_run", {
      nextTool: "kiwi_preview_run",
      reason: "preview token was not found",
    });
  }
  return readJson(target) as McpPreviewTokenRecord;
}

function rejectStale(reason: string): never {
  throw new ToolActionRequiredError(`Stale previewToken: ${reason}`, {
    nextTool: "kiwi_preview_run",
    reason,
  });
}

export function validateMcpPreviewToken(params: {
  cwd: string;
  runId: string;
  previewToken: string | undefined;
  previewInput?: McpPreviewInput | undefined;
  stepId?: string | undefined;
}): McpPreviewTokenRecord {
  if (!params.previewToken) {
    throw new ToolActionRequiredError("kiwi_run requires previewToken from kiwi_preview_run before MCP mutation", {
      nextTool: "kiwi_preview_run",
      reason: "mutating MCP calls require a fresh preview",
    });
  }
  const record = loadPreviewRecord(params.cwd, params.runId, params.previewToken);
  if (record.runId !== params.runId) rejectStale("preview token belongs to a different run");
  const current = fingerprintState(params.cwd, params.runId);
  const currentHash = stateHash(current.fingerprints, record.previewInput);
  if (currentHash !== record.stateHash) rejectStale("TaskGraph, policy, HEAD, or dirty state changed");
  if (params.previewInput) {
    if (
      record.previewInput.fromStep !== params.previewInput.fromStep ||
      record.previewInput.maxConcurrency !== params.previewInput.maxConcurrency
    ) {
      rejectStale("fromStep or maxConcurrency differs from the preview");
    }
  }
  if (params.stepId && !record.previewStepIds.includes(params.stepId)) {
    rejectStale(`step ${params.stepId} was not included in the preview`);
  }
  appendAuditEvent(params.cwd, {
    eventType: "mcp_preview_consumed",
    runId: params.runId,
    timestamp: new Date().toISOString(),
    payload: {
      token: record.token,
      stepId: params.stepId ?? null,
    },
  });
  return record;
}

function previewDir(cwd: string, runId: string): string {
  return resolveRunArtifactPath(runId, "previews", cwd);
}

export function latestValidPreviewToken(params: {
  cwd: string;
  runId: string;
  previewInput: McpPreviewInput;
}): McpPreviewTokenRecord | null {
  const dir = previewDir(params.cwd, params.runId);
  if (!existsSync(dir)) return null;
  const records = readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try {
        return readJson(path.join(dir, entry)) as McpPreviewTokenRecord;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is McpPreviewTokenRecord => entry !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const record of records) {
    try {
      const current = fingerprintState(params.cwd, params.runId);
      const currentHash = stateHash(current.fingerprints, record.previewInput);
      if (currentHash !== record.stateHash) continue;
      if (
        record.previewInput.fromStep !== params.previewInput.fromStep ||
        record.previewInput.maxConcurrency !== params.previewInput.maxConcurrency
      ) {
        continue;
      }
      return record;
    } catch {
      return null;
    }
  }
  return null;
}
