export class KiwiError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "KiwiError";
    this.code = code;
  }
}

export class NotInitializedError extends KiwiError {
  public constructor(repoPath: string) {
    super("NOT_INITIALIZED", `Project is not initialized at ${repoPath}. Run 'kiwi init' first.`);
  }
}

export class TicketNotFoundError extends KiwiError {
  public constructor(ticketPath: string) {
    super("TICKET_NOT_FOUND", `Ticket file not found: ${ticketPath}`);
  }
}

export class RunNotFoundError extends KiwiError {
  public constructor(runId: string) {
    super("RUN_NOT_FOUND", `Run not found: ${runId}`);
  }
}

export class RunCorruptError extends KiwiError {
  public constructor(runId: string, reason: string) {
    super("RUN_CORRUPT", `Run ${runId} is corrupt: ${reason}`);
  }
}

export interface BudgetExceededErrorContext {
  budgetProfile: string;
  remainingUsdEstimate: number;
  estimatedAttemptCostUsd: number;
  modelId: string | null;
  modelCapability: string;
  contextLevel: string;
}

export class BudgetExceededError extends KiwiError {
  public readonly context: BudgetExceededErrorContext;

  public constructor(context: BudgetExceededErrorContext) {
    super(
      "BUDGET_EXCEEDED",
      `Estimated attempt cost $${context.estimatedAttemptCostUsd.toFixed(4)} exceeds remaining budget $${context.remainingUsdEstimate.toFixed(4)}.`,
    );
    this.context = context;
  }
}
