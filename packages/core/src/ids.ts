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

export function generateInitiativeId(
  now: Date = new Date(),
  options: IdGenerationOptions = {},
): string {
  return `init_${dateToken(now)}_${idSuffix(options)}`;
}

export function generateRunId(
  now: Date = new Date(),
  options: IdGenerationOptions = {},
): string {
  return `run_${dateToken(now)}_${idSuffix(options)}`;
}

export function generatePlanId(
  now: Date = new Date(),
  options: IdGenerationOptions = {},
): string {
  return `plan_${dateToken(now)}_${idSuffix(options)}`;
}

export function generateStepId(index: number): string {
  return `step_${String(index + 1).padStart(3, "0")}`;
}
