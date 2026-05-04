import { describe, expect, it } from "vitest";
import {
  BitbucketCloudRequest,
  BitbucketCloudScmAdapter,
} from "../bitbucket-cloud-scm-adapter";

const repository = {
  provider: "bitbucket-cloud" as const,
  workspace: "kiwi",
  repoSlug: "ai-kiwi",
};

function adapterWithCapturedRequests(requests: BitbucketCloudRequest[]): BitbucketCloudScmAdapter {
  let id = 40;
  return new BitbucketCloudScmAdapter({
    now: () => new Date("2026-05-04T08:00:00.000Z"),
    request: async (request) => {
      requests.push(request);
      id += 1;
      return {
        status: 201,
        body: {
          id,
          links: {
            html: {
              href: `https://bitbucket.org/kiwi/ai-kiwi/pull-requests/${id}`,
            },
          },
        },
      };
    },
  });
}

describe("BitbucketCloudScmAdapter", () => {
  it("creates Bitbucket issues without accepting credentials", async () => {
    const requests: BitbucketCloudRequest[] = [];
    const adapter = adapterWithCapturedRequests(requests);

    const result = await adapter.createTicket({
      repository,
      title: "Implement orchestration",
      body: "Keep the credential boundary outside Kiwi.",
    });

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.bitbucket.org/2.0/repositories/kiwi/ai-kiwi/issues",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: {
        title: "Implement orchestration",
        content: {
          raw: "Keep the credential boundary outside Kiwi.",
          markup: "markdown",
        },
      },
    });
    expect(requests[0]?.headers.Authorization).toBeUndefined();
    expect(result).toMatchObject({
      provider: "bitbucket-cloud",
      authMode: "external",
      status: "created",
      externalId: "41",
      createdAt: "2026-05-04T08:00:00.000Z",
    });
  });

  it("creates Bitbucket pull request requests from branch drafts", async () => {
    const requests: BitbucketCloudRequest[] = [];
    const adapter = adapterWithCapturedRequests(requests);

    const result = await adapter.createPullRequest({
      repository,
      title: "Runner adapter",
      description: "Adds the provider-neutral boundary.",
      sourceBranch: "codex/scm-adapter",
      destinationBranch: "main",
      draft: true,
    });

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.bitbucket.org/2.0/repositories/kiwi/ai-kiwi/pullrequests",
      body: {
        title: "Runner adapter",
        description: "Adds the provider-neutral boundary.",
        source: { branch: { name: "codex/scm-adapter" } },
        destination: { branch: { name: "main" } },
        close_source_branch: false,
        draft: true,
      },
    });
    expect(result.externalId).toBe("41");
  });

  it("publishes pull request reviews as comments, tasks, and change requests", async () => {
    const requests: BitbucketCloudRequest[] = [];
    const adapter = adapterWithCapturedRequests(requests);

    const result = await adapter.publishPullRequestReview({
      repository,
      pullRequestId: 7,
      summary: "Review summary",
      comments: [
        {
          body: "Please cover this branch.",
          filePath: "src/index.ts",
          line: 12,
          createTask: true,
        },
      ],
      requestChanges: true,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.bitbucket.org/2.0/repositories/kiwi/ai-kiwi/pullrequests/7/comments",
      "https://api.bitbucket.org/2.0/repositories/kiwi/ai-kiwi/pullrequests/7/comments",
      "https://api.bitbucket.org/2.0/repositories/kiwi/ai-kiwi/pullrequests/7/tasks",
      "https://api.bitbucket.org/2.0/repositories/kiwi/ai-kiwi/pullrequests/7/request-changes",
    ]);
    expect(requests[1]?.body).toMatchObject({
      content: {
        raw: "Please cover this branch.",
        markup: "markdown",
      },
      inline: {
        path: "src/index.ts",
        to: 12,
      },
    });
    expect(requests[2]?.body).toMatchObject({
      content: {
        raw: "Please cover this branch.",
      },
      pending: true,
      comment: {
        id: 42,
      },
    });
    expect(result).toMatchObject({
      provider: "bitbucket-cloud",
      authMode: "external",
      status: "created",
      externalId: "41",
    });
  });

  it("rejects non-Bitbucket repositories", async () => {
    const adapter = adapterWithCapturedRequests([]);

    await expect(adapter.createTicket({
      repository: {
        provider: "github",
        remoteUrl: "https://github.com/kiwi/ai-kiwi",
      },
      title: "Wrong provider",
      body: "",
    })).rejects.toThrow("cannot publish to provider 'github'");
  });
});
