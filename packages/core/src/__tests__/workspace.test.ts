import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { discoverWorkspaceRepos, resolveWorkspace } from "../workspace";

function setupVoiceLikeWorkspace(): { root: string; core: string; agent: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "kiwi-workspace-"));
  const core = path.join(root, "voice-core");
  const agent = path.join(root, "voice-livekit-agent");
  mkdirSync(core);
  mkdirSync(agent);
  writeFileSync(
    path.join(root, "workspace.code-workspace"),
    JSON.stringify({
      folders: [
        { name: "voice-core", path: "voice-core" },
        { name: "voice-livekit-agent", path: "voice-livekit-agent" },
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
    const { root, core, agent } = setupVoiceLikeWorkspace();
    const repos = discoverWorkspaceRepos(root);

    expect(repos).toEqual([
      { id: "voice-core", path: core },
      { id: "voice-livekit-agent", path: agent },
    ]);
  });

  it("selects the containing repo when called from inside a workspace repo", () => {
    const { root, core } = setupVoiceLikeWorkspace();
    const resolved = resolveWorkspace({ cwd: path.join(core), requireRepo: true });

    expect(resolved.workspacePath).toBe(root);
    expect(resolved.repo?.id).toBe("voice-core");
    expect(resolved.repo?.path).toBe(core);
  });

  it("supports explicit workspace and repo selectors", () => {
    const { root, agent } = setupVoiceLikeWorkspace();
    const resolved = resolveWorkspace({
      cwd: os.tmpdir(),
      workspacePath: root,
      repo: "voice-livekit-agent",
      requireRepo: true,
    });

    expect(resolved.workspacePath).toBe(root);
    expect(resolved.repo?.path).toBe(agent);
  });

  it("fails clearly when a multi-repo workspace has no selected repo", () => {
    const { root } = setupVoiceLikeWorkspace();

    expect(() => resolveWorkspace({ cwd: root, requireRepo: true })).toThrow(
      /Repo is ambiguous.*voice-core.*voice-livekit-agent/,
    );
  });
});
