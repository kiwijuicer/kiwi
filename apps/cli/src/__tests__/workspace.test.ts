import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { runWorkspaceList } from "../commands/workspace";

describe("kiwi workspace", () => {
  it("lists repos detected from a .code-workspace file", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-workspace-"));
    mkdirSync(path.join(workspace, "voice-core"));
    mkdirSync(path.join(workspace, "voice-livekit-agent"));
    writeFileSync(
      path.join(workspace, "workspace.code-workspace"),
      JSON.stringify({
        folders: [
          { name: "voice-core", path: "voice-core" },
          { name: "voice-livekit-agent", path: "voice-livekit-agent" },
        ],
      }),
      "utf-8",
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runWorkspaceList({ workspace }, os.tmpdir());
    const output = spy.mock.calls.flat().join("\n");
    spy.mockRestore();

    expect(output).toContain(`workspace: ${workspace}`);
    expect(output).toContain("repos: 2");
    expect(output).toContain("voice-core");
    expect(output).toContain("voice-livekit-agent");
  });
});
