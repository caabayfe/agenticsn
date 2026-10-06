import { describe, expect, it } from "bun:test";
import { status } from "../../src/registry/status";

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
