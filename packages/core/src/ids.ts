import { randomBytes } from "crypto";

export interface IdGenerationOptions {
  suffix?: string;
}

const PLANNED_RUN_TIME_ZONE = "Europe/Berlin";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "00";
}

function localDateToken(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return (
    `${datePart(parts, "year")}` +
    `${datePart(parts, "month")}` +
    `${datePart(parts, "day")}` +
    `_` +
    `${datePart(parts, "hour")}` +
    `${datePart(parts, "minute")}` +
    `${datePart(parts, "second")}`
  );
}

function plannedRunDateToken(now: Date = new Date()): string {
  return localDateToken(now, PLANNED_RUN_TIME_ZONE);
}

function suffix(size = 2): string {
  return randomBytes(size).toString("hex");
}

function idSuffix(options: IdGenerationOptions): string {
  return options.suffix ?? suffix(2);
}

export function generateInitiativeId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `init_${plannedRunDateToken(now)}_${idSuffix(options)}`;
}

export function generateRunId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `run_${plannedRunDateToken(now)}_${idSuffix(options)}`;
}

export function generatePlanId(now: Date = new Date(), options: IdGenerationOptions = {}): string {
  return `plan_${plannedRunDateToken(now)}_${idSuffix(options)}`;
}

export function generateStepId(index: number): string {
  return `step_${String(index + 1).padStart(3, "0")}`;
}
