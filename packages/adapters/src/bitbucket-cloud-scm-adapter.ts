import {
  ScmMutationResult,
  ScmMutationResultSchema,
  ScmPullRequestDraftInput,
  ScmPullRequestDraftSchema,
  ScmPullRequestReviewDraftInput,
  ScmPullRequestReviewDraftSchema,
  ScmRepositoryRef,
  ScmRepositoryRefSchema,
  ScmTicketDraftInput,
  ScmTicketDraftSchema,
} from "@kiwi/contracts";
import { ScmAdapter } from "./scm-adapter";

export interface BitbucketCloudRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface BitbucketCloudResponse {
  status: number;
  body?: unknown;
}

export type BitbucketCloudRequestExecutor = (request: BitbucketCloudRequest) => Promise<BitbucketCloudResponse>;

export interface BitbucketCloudScmAdapterOptions {
  request: BitbucketCloudRequestExecutor;
  apiBaseUrl?: string;
  now?: () => Date;
}

interface BitbucketResponseLinks {
  html?: {
    href?: unknown;
  };
}

interface BitbucketResponseBody {
  id?: unknown;
  links?: BitbucketResponseLinks;
}

export class BitbucketCloudScmAdapter implements ScmAdapter {
  readonly provider = "bitbucket-cloud";
  readonly authMode = "external";
  private readonly request: BitbucketCloudRequestExecutor;
  private readonly apiBaseUrl: string;
  private readonly now: () => Date;

  constructor(options: BitbucketCloudScmAdapterOptions) {
    this.request = options.request;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.bitbucket.org/2.0").replace(/\/+$/, "");
    this.now = options.now ?? (() => new Date());
  }

  async createTicket(input: ScmTicketDraftInput): Promise<ScmMutationResult> {
    const draft = ScmTicketDraftSchema.parse(input);
    const response = await this.request({
      method: "POST",
      url: this.url(draft.repository, "issues"),
      headers: jsonHeaders(),
      body: {
        title: draft.title,
        ...(draft.body
          ? {
              content: {
                raw: draft.body,
                markup: "markdown",
              },
            }
          : {}),
      },
    });

    return this.result(response);
  }

  async createPullRequest(input: ScmPullRequestDraftInput): Promise<ScmMutationResult> {
    const draft = ScmPullRequestDraftSchema.parse(input);
    const body: Record<string, unknown> = {
      title: draft.title,
      source: {
        branch: {
          name: draft.sourceBranch,
        },
      },
      close_source_branch: draft.closeSourceBranch,
      draft: draft.draft,
    };
    if (draft.description) body.description = draft.description;
    if (draft.destinationBranch) {
      body.destination = {
        branch: {
          name: draft.destinationBranch,
        },
      };
    }

    const response = await this.request({
      method: "POST",
      url: this.url(draft.repository, "pullrequests"),
      headers: jsonHeaders(),
      body,
    });

    return this.result(response);
  }

  async publishPullRequestReview(input: ScmPullRequestReviewDraftInput): Promise<ScmMutationResult> {
    const draft = ScmPullRequestReviewDraftSchema.parse(input);
    const pullRequestId = String(draft.pullRequestId);
    const basePath = `pullrequests/${encodeSegment(pullRequestId)}`;
    const responses: BitbucketCloudResponse[] = [];

    if (draft.summary.trim().length > 0) {
      responses.push(await this.createPullRequestComment(draft.repository, basePath, draft.summary));
    }

    for (const comment of draft.comments) {
      const commentBody: Record<string, unknown> = {
        content: {
          raw: comment.body,
          markup: "markdown",
        },
      };
      if (comment.filePath && comment.line) {
        commentBody.inline = {
          path: comment.filePath,
          to: comment.line,
        };
      }

      const commentResponse = await this.createPullRequestComment(
        draft.repository,
        basePath,
        comment.body,
        commentBody,
      );
      responses.push(commentResponse);

      if (comment.createTask) {
        const commentId = responseId(commentResponse);
        const taskBody: Record<string, unknown> = {
          content: {
            raw: comment.body,
          },
          pending: true,
        };
        if (commentId) taskBody.comment = { id: Number(commentId) };
        responses.push(await this.createPullRequestTask(draft.repository, basePath, taskBody));
      }
    }

    if (draft.requestChanges) {
      responses.push(
        await this.request({
          method: "POST",
          url: this.url(draft.repository, `${basePath}/request-changes`),
          headers: jsonHeaders(),
        }),
      );
    }

    if (responses.length === 0) {
      return ScmMutationResultSchema.parse({
        provider: this.provider,
        authMode: this.authMode,
        status: "draft",
        externalId: pullRequestId,
        evidenceRefs: [],
        createdAt: this.now().toISOString(),
      });
    }

    const failed = responses.find((response) => !isSuccess(response.status));
    if (failed) return this.result(failed, pullRequestId);

    return this.result(responses[0]!, pullRequestId);
  }

  private async createPullRequestComment(
    repository: ScmRepositoryRef,
    basePath: string,
    raw: string,
    body: Record<string, unknown> = {
      content: {
        raw,
        markup: "markdown",
      },
    },
  ): Promise<BitbucketCloudResponse> {
    return this.request({
      method: "POST",
      url: this.url(repository, `${basePath}/comments`),
      headers: jsonHeaders(),
      body,
    });
  }

  private async createPullRequestTask(
    repository: ScmRepositoryRef,
    basePath: string,
    body: Record<string, unknown>,
  ): Promise<BitbucketCloudResponse> {
    return this.request({
      method: "POST",
      url: this.url(repository, `${basePath}/tasks`),
      headers: jsonHeaders(),
      body,
    });
  }

  private url(repository: ScmRepositoryRef, suffix: string): string {
    const repo = ScmRepositoryRefSchema.parse(repository);
    if (repo.provider !== "bitbucket-cloud") {
      throw new Error(`BitbucketCloudScmAdapter cannot publish to provider '${repo.provider}'`);
    }

    return `${this.apiBaseUrl}/repositories/${encodeSegment(repo.workspace!)}/${encodeSegment(repo.repoSlug!)}/${suffix}`;
  }

  private result(response: BitbucketCloudResponse, fallbackId?: string): ScmMutationResult {
    const body = responseBody(response);
    const id = responseId(response) ?? fallbackId;
    return ScmMutationResultSchema.parse({
      provider: this.provider,
      authMode: this.authMode,
      status: isSuccess(response.status) ? "created" : "failed",
      ...(id ? { externalId: id } : {}),
      ...(typeof body.links?.html?.href === "string" ? { externalUrl: body.links.html.href } : {}),
      evidenceRefs: [],
      createdAt: this.now().toISOString(),
    });
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function jsonHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function responseBody(response: BitbucketCloudResponse): BitbucketResponseBody {
  if (typeof response.body !== "object" || response.body === null) return {};
  return response.body as BitbucketResponseBody;
}

function responseId(response: BitbucketCloudResponse): string | undefined {
  const id = responseBody(response).id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return undefined;
}
