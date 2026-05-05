import { publishPrDraft, withRunLock } from "@kiwi/core";

export function publishPrDraftTool(args: Record<string, unknown>, workspacePath: string): Promise<unknown> {
  return withRunLock({ cwd: workspacePath, runId: String(args.runId ?? ""), operation: "mcp_publish_pr_draft" }, () => {
    const input: Parameters<typeof publishPrDraft>[0] = {
      cwd: workspacePath,
      runId: String(args.runId ?? ""),
    };
    if (typeof args.remote === "string") input.remote = args.remote;
    if (typeof args.targetBranch === "string") input.targetBranch = args.targetBranch;
    if (typeof args.branchName === "string") input.branchName = args.branchName;
    return publishPrDraft(input);
  });
}
