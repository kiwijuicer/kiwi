import {
  ScmAuthMode,
  ScmMutationResult,
  ScmProvider,
  ScmPullRequestDraftInput,
  ScmPullRequestReviewDraftInput,
  ScmTicketDraftInput,
} from "@ai-kiwi/contracts";

export interface ScmAdapter {
  readonly provider: ScmProvider;
  readonly authMode: ScmAuthMode;
  createTicket(input: ScmTicketDraftInput): Promise<ScmMutationResult>;
  createPullRequest(input: ScmPullRequestDraftInput): Promise<ScmMutationResult>;
  publishPullRequestReview(input: ScmPullRequestReviewDraftInput): Promise<ScmMutationResult>;
}
