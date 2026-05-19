import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { discoverWorkspaceRepos, resolveWorkspace } from "../../workspace";

function setupMultiRepoWorkspace(): { root: string; core: string; agent: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "kiwi-workspace-"));
  const core = path.join(root, "api-service");
  const agent = path.join(root, "worker-service");
  mkdirSync(core);
  mkdirSync(agent);
  writeFileSync(
    path.join(root, "workspace.code-workspace"),
    JSON.stringify({
      folders: [
        { name: "api-service", path: "api-service" },
        { name: "worker-service", path: "worker-service" },
      ],
    }),
    "utf-8",
  );

  return { root, core, agent };
}

describe("workspace resolution", () => {
  it("treats a plain directory as a single-repo workspace", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kiwi-single-repo-"));
    const resolved = resolveWorkspace({ cwd: root, requireRepo: true });

    expect(resolved.workspacePath).toBe(root);
    expect(resolved.repo?.id).toBe(path.basename(root));
    expect(resolved.repo?.path).toBe(root);
  });

  it("discovers repos from .code-workspace files", () => {
    const { root, core, agent } = setupMultiRepoWorkspace();
    const repos = discoverWorkspaceRepos(root);

    expect(repos).toEqual([
      { id: "api-service", path: core },
      { id: "worker-service", path: agent },
    ]);
  });

  it("selects the containing repo when called from inside a workspace repo", () => {
    const { root, core } = setupMultiRepoWorkspace();
    const resolved = resolveWorkspace({ cwd: path.join(core), requireRepo: true });

    expect(resolved.workspacePath).toBe(root);
    expect(resolved.repo?.id).toBe("api-service");
    expect(resolved.repo?.path).toBe(core);
  });

  it("supports explicit workspace and repo selectors", () => {
    const { root, agent } = setupMultiRepoWorkspace();
    const resolved = resolveWorkspace({
      cwd: os.tmpdir(),
      workspacePath: root,
      repo: "worker-service",
      requireRepo: true,
    });

    expect(resolved.workspacePath).toBe(root);
    expect(resolved.repo?.path).toBe(agent);
  });

  it("fails clearly when a multi-repo workspace has no selected repo", () => {
    const { root } = setupMultiRepoWorkspace();

    expect(() => resolveWorkspace({ cwd: root, requireRepo: true })).toThrow(
      /Repo is ambiguous.*api-service.*worker-service/,
    );
  });
});
