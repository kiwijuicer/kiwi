export const ProviderAttemptTypes = {
  Initial: "initial",
  Repair: "repair",
} as const;

export type ProviderAttemptType = (typeof ProviderAttemptTypes)[keyof typeof ProviderAttemptTypes];

export const ProviderValidationStatuses = {
  Valid: "valid",
  Invalid: "invalid",
} as const;

export type ProviderValidationStatus = (typeof ProviderValidationStatuses)[keyof typeof ProviderValidationStatuses];

export const ProviderFailureCodes = {
  RateLimited: "provider_rate_limited",
  Timeout: "provider_timeout",
  Network: "provider_network",
  SchemaInvalid: "provider_schema_invalid",
  ContentPolicy: "provider_content_policy",
  Auth: "provider_auth",
} as const;

export type ProviderFailureCode = (typeof ProviderFailureCodes)[keyof typeof ProviderFailureCodes];

export const CliOutputFormats = {
  Json: "json",
  Text: "text",
  StreamJson: "stream-json",
} as const;

export type CliOutputFormat = (typeof CliOutputFormats)[keyof typeof CliOutputFormats];

export const SubprocessStreams = {
  Stdout: "stdout",
  Stderr: "stderr",
} as const;

export type SubprocessStream = (typeof SubprocessStreams)[keyof typeof SubprocessStreams];

export const CodexApprovalPolicies = {
  Untrusted: "untrusted",
  OnFailure: "on-failure",
  OnRequest: "on-request",
  Never: "never",
} as const;

export type CodexApprovalPolicy = (typeof CodexApprovalPolicies)[keyof typeof CodexApprovalPolicies];

export const CodexApprovalsReviewers = {
  User: "user",
  AutoReview: "auto_review",
  GuardianSubagent: "guardian_subagent",
} as const;

export type CodexApprovalsReviewer = (typeof CodexApprovalsReviewers)[keyof typeof CodexApprovalsReviewers];

export const RepoContextStatuses = {
  Ok: "ok",
  Missing: "missing",
  NotDirectory: "not_directory",
  Unreadable: "unreadable",
} as const;

export type RepoContextStatus = (typeof RepoContextStatuses)[keyof typeof RepoContextStatuses];
