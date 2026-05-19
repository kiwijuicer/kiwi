import { z } from "zod";
import {
  ContractsSchemaVersionSchema,
  IsoDateTimeSchema,
  ReviewIssueSeveritySchema,
  ScmAuthModeSchema,
  ScmMutationStatusSchema,
  ScmProviderSchema,
  ScmProviders,
} from "../shared/common.js";

export const ScmRepositoryRefSchema = z
  .object({
    provider: ScmProviderSchema,
    workspace: z.string().min(1).optional(),
    repoSlug: z.string().min(1).optional(),
    remoteUrl: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider !== ScmProviders.BitbucketCloud) {
      return;
    }
    if (!value.workspace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace"],
        message: "bitbucket-cloud repository refs require workspace",
      });
    }
    if (!value.repoSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoSlug"],
        message: "bitbucket-cloud repository refs require repoSlug",
      });
    }
  });

export const ScmTicketDraftSchema = z.object({
  repository: ScmRepositoryRefSchema,
  title: z.string().min(1),
  body: z.string().default(""),
  labels: z.array(z.string().min(1)).default([]),
});

export const ScmPullRequestDraftSchema = z.object({
  repository: ScmRepositoryRefSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  sourceBranch: z.string().min(1),
  destinationBranch: z.string().min(1).optional(),
  closeSourceBranch: z.boolean().default(false),
  draft: z.boolean().default(false),
});

export const ScmPullRequestReviewCommentSchema = z.object({
  body: z.string().min(1),
  filePath: z.string().min(1).optional(),
  line: z.number().int().min(1).optional(),
  severity: ReviewIssueSeveritySchema.optional(),
  createTask: z.boolean().default(false),
});

export const ScmPullRequestReviewDraftSchema = z.object({
  repository: ScmRepositoryRefSchema,
  pullRequestId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  summary: z.string().default(""),
  comments: z.array(ScmPullRequestReviewCommentSchema).default([]),
  requestChanges: z.boolean().default(false),
});

export const ScmMutationResultSchema = z.object({
  provider: ScmProviderSchema,
  authMode: ScmAuthModeSchema,
  status: ScmMutationStatusSchema,
  externalId: z.string().min(1).optional(),
  externalUrl: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  createdAt: IsoDateTimeSchema.optional(),
});

export const PrDraftArtifactSchema = z.object({
  schemaVersion: ContractsSchemaVersionSchema,
  runId: z.string().regex(/^run_[a-z0-9_]+$/),
  repository: ScmRepositoryRefSchema,
  remote: z.string().min(1),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  createUrl: z.string().url(),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  diffHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  pushedAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

export type ScmRepositoryRef = z.infer<typeof ScmRepositoryRefSchema>;
export type ScmTicketDraft = z.infer<typeof ScmTicketDraftSchema>;
export type ScmTicketDraftInput = z.input<typeof ScmTicketDraftSchema>;
export type ScmPullRequestDraft = z.infer<typeof ScmPullRequestDraftSchema>;
export type ScmPullRequestDraftInput = z.input<typeof ScmPullRequestDraftSchema>;
export type ScmPullRequestReviewComment = z.infer<typeof ScmPullRequestReviewCommentSchema>;
export type ScmPullRequestReviewDraft = z.infer<typeof ScmPullRequestReviewDraftSchema>;
export type ScmPullRequestReviewDraftInput = z.input<typeof ScmPullRequestReviewDraftSchema>;
export type ScmMutationResult = z.infer<typeof ScmMutationResultSchema>;
export type PrDraftArtifact = z.infer<typeof PrDraftArtifactSchema>;
export type ScmProvider = z.infer<typeof ScmProviderSchema>;
export type ScmAuthMode = z.infer<typeof ScmAuthModeSchema>;
export type ScmMutationStatus = z.infer<typeof ScmMutationStatusSchema>;
