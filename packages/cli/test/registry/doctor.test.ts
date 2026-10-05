import { describe, expect, it } from "bun:test";
import { doctor } from "../../src/registry/doctor";
import { executeUseCase } from "../../src/registry/execute";
import { fakeProbe } from "../support/fakes";

describe("doctor use case", () => {
  it("exits with 0 when every check passes or is unavailable", async () => {
    const context = {
      environmentProbes: [fakeProbe("git", "ok"), fakeProbe("keychain", "unavailable")],
    };
    expect((await executeUseCase(doctor, {}, context)).exitCode).toBe(0);
  });

  it("exits with 3 (precondition) when a check fails", async () => {
    const context = { environmentProbes: [fakeProbe("git", "fail")] };
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

  it("refuses instance checks until instance profiles exist", async () => {
    const context = { environmentProbes: [] };
    await expect(executeUseCase(doctor, { local: false }, context)).rejects.toMatchObject({
      code: "invalid-input",
    });
  });
});
