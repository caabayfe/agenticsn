import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { doctor } from "../../src/registry/doctor";
import { executeUseCase } from "../../src/registry/execute";
import { FAKE_CONTEXT, fakeProbe } from "../support/fakes";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("doctor use case", () => {
  it("exits with 0 when every check passes or is unavailable", async () => {
    const context = {
      ...FAKE_CONTEXT,
      environmentProbes: [fakeProbe("git", "ok"), fakeProbe("keychain", "unavailable")],
    };
    expect((await executeUseCase(doctor, {}, context)).exitCode).toBe(0);
  });

  it("checks the agent pack inside a workspace, as a warning", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const context = { ...ws.context, environmentProbes: [fakeProbe("git", "ok")] };
    const { output, exitCode } = await executeUseCase(doctor, {}, context);
    expect(output["checks"]).toEqual([
      expect.objectContaining({ name: "git" }),
      expect.objectContaining({ name: "agent-pack", status: "warn" }),
      expect.objectContaining({ name: "mcp-config", status: "ok" }),
      expect.objectContaining({ name: "git-tuning", status: "ok" }),
      expect.objectContaining({ name: "mirror-line-endings", status: "ok" }),
    ]);
    expect(exitCode).toBe(0);
  });

  // Spec 014, PERF2-04: a teammate's plain git clone lacks init's large-repository tuning.
  it("warns when the workspace clone lacks the large-repository git settings", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    // A real store whose repository reports one setting unset, as after a plain git clone.
    const workspaces = Object.assign(new FsWorkspaceStore(), {
      repositoryTuning: async () => [{ key: "feature.manyFiles", value: "true", current: null }],
    });
    const context = { ...ws.context, workspaces, environmentProbes: [fakeProbe("git", "ok")] };
    const { output, exitCode } = await executeUseCase(doctor, {}, context);
    expect(output["checks"]).toContainEqual(
      expect.objectContaining({ name: "git-tuning", status: "warn" }),
    );
    expect(exitCode).toBe(0);
  });

  // Spec 014, 1b-L: a workspace created before init wrote the rule.
  it("warns when .gitattributes lacks the rule that keeps the mirror byte for byte", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await Bun.write(join(ws.root, ".gitattributes"), "*.png binary\n");
    const context = { ...ws.context, environmentProbes: [fakeProbe("git", "ok")] };
    const { output, exitCode } = await executeUseCase(doctor, {}, context);
    expect(output["checks"]).toContainEqual(
      expect.objectContaining({ name: "mirror-line-endings", status: "warn" }),
    );
    expect(exitCode).toBe(0);
  });

  it("fails when a committed MCP config gives snagentic's server a proxy", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const server = { command: "snagentic", args: ["mcp"], env: { HTTPS_PROXY: "http://p:8080" } };
    await Bun.write(
      join(ws.root, ".mcp.json"),
      JSON.stringify({ mcpServers: { snagentic: server } }),
    );
    const context = { ...ws.context, environmentProbes: [fakeProbe("git", "ok")] };
    const { output, exitCode } = await executeUseCase(doctor, {}, context);
    expect(output["checks"]).toContainEqual(
      expect.objectContaining({
        name: "mcp-config",
        status: "fail",
        detail: ".mcp.json sets HTTPS_PROXY",
      }),
    );
    expect(exitCode).toBe(3);
  });

  it("leaves the agent pack out outside a workspace", async () => {
    const context = { ...FAKE_CONTEXT, environmentProbes: [fakeProbe("git", "ok")] };
    const { output } = await executeUseCase(doctor, {}, context);
    expect(output["checks"]).toEqual([expect.objectContaining({ name: "git" })]);
  });

  it("exits with 3 (precondition) when a check fails", async () => {
    const context = { ...FAKE_CONTEXT, environmentProbes: [fakeProbe("git", "fail")] };
    expect((await executeUseCase(doctor, {}, context)).exitCode).toBe(3);
  });

  it("renders one line per check, with a hint under each problem", () => {
    const text = doctor.render(
      {
        ok: false,
        checks: [
          { name: "git", status: "ok", detail: "git version 2.54.0", hint: null },
          { name: "search-index", status: "fail", detail: "no FTS5", hint: "report it" },
        ],
      },
      "text",
    );
    expect(text.split("\n")).toEqual([
      "ok          git           git version 2.54.0",
      "fail        search-index  no FTS5",
      "             hint: report it",
      "doctor: 1 check(s) failed",
    ]);
  });

  it("explains how to find the workspace when --instance is used outside one", async () => {
    await expect(executeUseCase(doctor, { instance: "pdi" }, FAKE_CONTEXT)).rejects.toMatchObject({
      code: "workspace-not-found",
    });
  });

  it("renders warnings with their hint and does not count them as failures", () => {
    const text = doctor.render(
      {
        ok: true,
        checks: [{ name: "roles", status: "warn", detail: "roles: itil", hint: "grant admin" }],
      },
      "text",
    );
    expect(text.split("\n")).toEqual([
      "warn        roles  roles: itil",
      "             hint: grant admin",
      "doctor: ready (1 warning)",
    ]);
  });
});
