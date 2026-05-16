export class ToolActionRequiredError extends Error {
  readonly code = -32010 as const;
  readonly data: Record<string, unknown>;

  constructor(message: string, data: Record<string, unknown>) {
    super(message);
    this.name = "ToolActionRequiredError";
    this.data = data;
  }
}
