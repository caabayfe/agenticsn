import { afterEach, describe, expect, it } from "bun:test";
import { InstanceName } from "@snagentic/core";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
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
  next: "snagentic pull pdi",
};

describe("status rendering", () => {
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

  it("reads the push journal until a pull moves the mirror past it", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const git = (...args: string[]) =>
      runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], ws.root);
    await git("commit", "-q", "--allow-empty", "-m", "pull");
    await git("branch", "servicenow-remote/pdi");
    const mirror = (await git("rev-parse", "servicenow-remote/pdi")).trim();
    const journal = { planId: "p1", startedAt: "t", preference: null, steps: [] };
    await ws.context
      .pushJournal(ws.root, InstanceName.parse("pdi"))
      .write({ ...journal, mirrorCommit: mirror });
    const { output } = await executeUseCase(status, { instance: "pdi" }, ws.context);
    expect(output).toMatchObject({
      instances: [
        { unfinishedPush: "p1", next: "snagentic pull pdi, then snagentic integrate pdi" },
      ],
    });
    await ws.context
      .pushJournal(ws.root, InstanceName.parse("pdi"))
      .write({ ...journal, mirrorCommit: "0".repeat(40) });
    const later = await executeUseCase(status, { instance: "pdi" }, ws.context);
    expect(later.output).toMatchObject({ instances: [{ unfinishedPush: null }] });
  });
});
