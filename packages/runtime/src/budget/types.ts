import { SchedulerDecisionStatuses } from "@kiwi/contracts";

export const RunCostForecastStatuses = {
  Ok: "ok",
  Blocked: SchedulerDecisionStatuses.Blocked,
} as const;

export type RunCostForecastStatus = (typeof RunCostForecastStatuses)[keyof typeof RunCostForecastStatuses];
