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
    super(
      "NOT_INITIALIZED",
      `Project is not initialized at ${repoPath}. Run 'kiwi init' first.`,
    );
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
