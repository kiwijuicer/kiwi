import { randomBytes } from "crypto";

export interface IdGenerationOptions {
  suffix?: string;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function dateToken(now: Date = new Date()): string {
  return (
    `${now.getUTCFullYear()}` +
    `${pad(now.getUTCMonth() + 1)}` +
    `${pad(now.getUTCDate())}` +
    `_` +
    `${pad(now.getUTCHours())}` +
    `${pad(now.getUTCMinutes())}` +
    `${pad(now.getUTCSeconds())}`
  );
}

function suffix(size = 2): string {
  return randomBytes(size).toString("hex");
}

function idSuffix(options: IdGenerationOptions): string {
  return options.suffix ?? suffix(2);
}

function safeIdToken(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "") || suffix(2)
  );
}

export function generateInitiativeId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `init_${dateToken(now)}_${idSuffix(options)}`;
}

export function generateRunId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `run_${dateToken(now)}_${idSuffix(options)}`;
}

export function generatePlanId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `plan_${dateToken(now)}_${idSuffix(options)}`;
}

export function generateA2AMessageId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `msg_${dateToken(now)}_${idSuffix(options)}`;
}

export function generateA2ACorrelationId(value: string): string {
  return `corr_${safeIdToken(value)}`;
}

export function generateStepId(index: number): string {
  return `step_${String(index + 1).padStart(3, "0")}`;
}
