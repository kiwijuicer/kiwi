import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildRepoContextEnvelope, renderRepoContext } from "../../providers/repo-context";

function git(repoPath: string, args: string[]): void {
  execFileSync("git", ["-C", repoPath, ...args], { stdio: "ignore" });
}

describe("buildRepoContextEnvelope", () => {
  it("assembles bounded deterministic planner context", () => {
    const repoPath = mkdtempSync(path.join(tmpdir(), "kiwi-repo-context-"));
    mkdirSync(path.join(repoPath, "src"), { recursive: true });
    writeFileSync(path.join(repoPath, "README.md"), "# Demo\n\nAuth planner docs\n", "utf-8");
    writeFileSync(path.join(repoPath, "AGENTS.md"), "# Agents\n\nUse tests.\n", "utf-8");
    writeFileSync(path.join(repoPath, "src", "auth.ts"), "export const authPlanner = true;\n", "utf-8");
    git(repoPath, ["init"]);
    git(repoPath, ["add", "."]);
    execFileSync(
      "git",
      ["-C", repoPath, "-c", "user.name=Kiwi", "-c", "user.email=kiwi@example.com", "commit", "-m", "initial context"],
      {
        stdio: "ignore",
      },
    );
    writeFileSync(path.join(repoPath, "src", "auth.ts"), "export const authPlanner = false;\n", "utf-8");

    const context = buildRepoContextEnvelope({
      initiative: {
        title: "Auth planner",
        rawInput: "Find auth planner files",
        repoPath,
      },
    });

    expect(context.status).toBe("ok");
    expect(context.readmeHead).toContain("Auth planner docs");
    expect(context.agentsHead).toContain("Use tests.");
    expect(context.grepHits.some((hit) => hit.path === "src/auth.ts")).toBe(true);
    expect(context.filePaths).toContain("src/auth.ts");
    expect(context.recentCommits).toEqual(["initial context"]);
    expect(context.localDiffPaths).toEqual(["src/auth.ts"]);
    expect(renderRepoContext(context).length).toBeLessThanOrEqual(12_000);
  });
});
