import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { installProgress } from "../../src/registry/accelerator-install-progress";
import { callerFor } from "../../src/registry/install-steps";
import { defineUseCase, type ProgressEvent } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "../support/fakes";

// What an admin watches while an install runs: where it is, and how much is left.
describe("install progress", () => {
  it("says how many modules a run has, and on a resume how many are left", () => {
    const begin = { kind: "begin" as const, planId: "p1", title: "itsm 0.11.1 on pdi4" };
    expect(installProgress({ ...begin, modules: 13, finished: 0 }).message).toBe(
      "installing itsm 0.11.1 on pdi4: 13 module(s), plan p1",
    );
    expect(installProgress({ ...begin, modules: 13, finished: 4 }).message).toBe(
      "resuming plan p1, itsm 0.11.1 on pdi4: 4 of 13 module(s) done before, 9 to go",
    );
  });

  it("places each module among the plan's, and marks how its step ended", () => {
    const place = { first: 5, last: 5, total: 13 };
    expect(installProgress({ kind: "start", step: "module problem-sla", place })).toEqual({
      message: "[5/13] module problem-sla",
      depth: 1,
    });
    const together = { first: 1, last: 3, total: 13 };
    expect(installProgress({ kind: "start", step: "modules", place: together }).message).toBe(
      "[1-3/13] modules",
    );
    const end = {
      kind: "end" as const,
      step: "data",
      place: null,
      outcome: "done" as const,
      detail: "3 inserted",
      seconds: 12.4,
    };
    expect(installProgress(end)).toEqual({
      message: "data (12 s): 3 inserted",
      depth: 1,
      outcome: "done",
    });
  });

  it("shows each use case an install calls as a sub-step, in plain words", async () => {
    const events: ProgressEvent[] = [];
    const run = {
      signal: new AbortController().signal,
      progress: (e: ProgressEvent) => events.push(e),
    };
    const said = (name: string) =>
      defineUseCase({
        name,
        description: "d",
        input: z.object({}),
        output: z.object({}),
        flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
        mcp: false,
        handle: async (_input, _context, inner) => {
          inner.progress({ message: `inside ${name}`, completed: 1 });
          return {};
        },
        render: () => "",
        exitCode: () => 0,
      });
    const call = callerFor(FAKE_CONTEXT, run);
    await call(said("pull"), {});
    await call(said("push"), {});
    expect(events).toEqual([
      { message: "pulling the instance into the mirror", depth: 2 },
      { message: "inside pull", completed: 1, depth: 3 },
      { message: "loading the changes into the module's update set", depth: 2 },
    ]);
  });
});
