import { afterEach, describe, expect, it } from "bun:test";
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
    ]);
    expect(exitCode).toBe(0);
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
