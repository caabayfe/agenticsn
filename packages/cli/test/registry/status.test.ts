import { afterEach, describe, expect, it } from "bun:test";
import { InstanceName } from "@snagentic/core";
import { executeUseCase } from "../../src/registry/execute";
import { status } from "../../src/registry/status";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const BASE = {
  instance: "pdi",
  kind: "development" as const,
  url: "https://dev312411.service-now.com",
  phase: "integrated" as const,
  lastPull: "2026-10-06 09:15:00",
  lastFullPull: "2026-10-05 16:15:49",
  minutesSinceLastPull: 45,
  interrupted: null,
  remoteCommit: "abc",
  unintegratedPulls: 0,
  localChanges: [],
  unfinishedPush: null,
  domains: [],
  next: "snagentic pull pdi",
};

describe("status rendering", () => {
  it("names the instance's domains when it is domain-separated (ADR-0027)", () => {
    const text = status.render(
      { instances: [{ ...BASE, domains: [{ name: "Default", sysId: "d".repeat(32) }] }] },
      "text",
    );
    expect(text).toContain(`domains: Default (${"d".repeat(32)})`);
    expect(status.render({ instances: [BASE] }, "text")).not.toContain("domains:");
  });

  it("shows freshness, pending pulls and the next step", () => {
    const text = status.render(
      {
        instances: [
          {
            ...BASE,
            phase: "not-integrated",
            unintegratedPulls: 2,
            next: "snagentic integrate pdi",
          },
        ],
      },
      "text",
    );
    expect(text).toContain("pdi (development) https://dev312411.service-now.com");
    expect(text).toContain(
      "last pull 2026-10-06 09:15:00 UTC (45 min ago); last full pull 2026-10-05 16:15:49 UTC",
    );
    expect(text).toContain("2 pull(s) not integrated yet");
    expect(text).toContain("no local changes to synced files");
    expect(text).toContain("next: snagentic integrate pdi");
  });

  it.each([
    [90, "1 h ago"],
    [3 * 1440, "3 days ago"],
  ])("says %p minutes as %p", (minutes, said) => {
    expect(
      status.render({ instances: [{ ...BASE, minutesSinceLastPull: minutes }] }, "text"),
    ).toContain(said);
  });

  it("lists the first local changes and counts the rest", () => {
    const localChanges = Array.from({ length: 12 }, (_, i) => `f${i}.js`);
    const text = status.render({ instances: [{ ...BASE, localChanges }] }, "text");
    expect(text).toContain("12 local change(s): f0.js, f1.js");
    expect(text).toContain("(+2 more)");
  });

  it("explains an interrupted pull and a never-pulled instance", () => {
    const interrupted = {
      ...BASE,
      phase: "interrupted" as const,
      interrupted: { startedAt: "2026-10-06 08:00:00", completedClasses: 120 },
    };
    expect(status.render({ instances: [interrupted] }, "text")).toContain(
      "full pull interrupted (started 2026-10-06 08:00:00 UTC, 120 classes done); pulling again resumes it",
    );
    const never = {
      ...BASE,
      phase: "never-pulled" as const,
      lastPull: null,
      lastFullPull: null,
      minutesSinceLastPull: null,
    };
    expect(status.render({ instances: [never] }, "text")).toContain("never pulled");
  });

  it("suggests adding an instance when there is none", () => {
    expect(status.render({ instances: [] }, "text")).toContain("snagentic instance add");
  });
});

describe("status and a push that stopped part way", () => {
  it("says so, and that a pull comes next", () => {
    const text = status.render(
      {
        instances: [
          {
            ...BASE,
            unfinishedPush: "42dc29d87917ec7b",
            next: "snagentic pull pdi, then snagentic integrate pdi",
          },
        ],
      },
      "text",
    );
    expect(text).toContain(
      "push 42dc29d87917ec7b stopped part way: the instance may hold some of its writes",
    );
    expect(text).toContain("next: snagentic pull pdi, then snagentic integrate pdi");
  });

  it("reports a push that stopped part way until a push finishes it", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const journals = ws.context.pushJournal(ws.root, InstanceName.parse("pdi"));
    await journals.write({
      planId: "p1",
      mirrorCommit: "",
      startedAt: "t",
      preferences: [],
      steps: [],
    });
    const { output } = await executeUseCase(status, { instance: "pdi" }, ws.context);
    expect(output).toMatchObject({
      instances: [
        {
          unfinishedPush: "p1",
          next: "snagentic plan-push --instance pdi, then push: what reached the instance is only recorded",
        },
      ],
    });
    await journals.clear();
    const later = await executeUseCase(status, { instance: "pdi" }, ws.context);
    expect(later.output).toMatchObject({ instances: [{ unfinishedPush: null }] });
  });

  it("lists the instance's domains besides global, from the operational inventory", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const rows = [
      { sys_id: "global", name: "global" },
      { sys_id: "d".repeat(32), name: "Default" },
    ];
    const context = { ...ws.context, inventory: { read: async () => rows } };
    const { output } = await executeUseCase(status, { instance: "pdi" }, context);
    expect(output).toMatchObject({
      instances: [{ domains: [{ name: "Default", sysId: "d".repeat(32) }] }],
    });
  });
});
