import { describe, expect, it } from "bun:test";
import { checkAgentPack, type WorkspaceFiles, withInstructions } from "@snagentic/core";

const filesWith = (agentsMd: string | null): WorkspaceFiles => ({
  read: async (path) => (path === "/w/AGENTS.md" ? agentsMd : null),
  write: async () => {},
});

describe("the agent pack check", () => {
  it("is ok when the workspace has this version's pack", async () => {
    expect(
      await checkAgentPack(filesWith(withInstructions(null, "x", "1.1.0")), "/w", "1.1.0"),
    ).toEqual({
      name: "agent-pack",
      status: "ok",
      detail: "1.1.0 installed",
      hint: null,
    });
  });

  it("warns when the pack is missing or from another version", async () => {
    expect(await checkAgentPack(filesWith("# ours"), "/w", "1.1.0")).toMatchObject({
      status: "warn",
      detail: "not installed in this workspace",
      hint: "run snagentic agent install, then commit the files",
    });
    expect(
      await checkAgentPack(filesWith(withInstructions(null, "x", "1.0.0")), "/w", "1.1.0"),
    ).toMatchObject({
      status: "warn",
      detail: "1.0.0 installed; this is snagentic 1.1.0",
    });
  });
});
