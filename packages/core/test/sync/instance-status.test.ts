import { describe, expect, it } from "bun:test";
import {
  instanceStatus,
  type MirrorView,
  type PullCheckpoint,
  type SyncState,
  type SyncStateStore,
} from "@snagentic/core";

const NOW = new Date("2026-10-06T10:00:00Z");
const PULLED: SyncState = { watermark: "2026-10-06 09:15:00", lastFullPull: "2026-10-05 16:15:49" };
const NO_VIEW: MirrorView = { remoteCommit: null, unintegratedPulls: 0, localChanges: [] };

function deps(state: SyncState | null, checkpoint: PullCheckpoint | null, view = NO_VIEW) {
  const store: SyncStateStore = {
    readCatalog: async () => null,
    writeCatalog: async () => {},
    readCheckpoint: async () => checkpoint,
    writeCheckpoint: async () => {},
    clearCheckpoint: async () => {},
    readState: async () => state,
    writeState: async () => {},
  };
  return { state: store, inspector: { inspect: async () => view }, now: () => NOW };
}

describe("instanceStatus", () => {
  it("tells a never-pulled instance to pull", async () => {
    const status = await instanceStatus("/w", "pdi", deps(null, null));
    expect(status).toMatchObject({
      phase: "never-pulled",
      lastPull: null,
      minutesSinceLastPull: null,
      next: "snagentic pull pdi",
    });
  });

  it("reports how long ago the last pull was and what is not integrated yet", async () => {
    const view = { remoteCommit: "abc", unintegratedPulls: 2, localChanges: [] };
    const status = await instanceStatus("/w", "pdi", deps(PULLED, null, view));
    expect(status).toMatchObject({
      phase: "not-integrated",
      lastPull: "2026-10-06 09:15:00",
      lastFullPull: "2026-10-05 16:15:49",
      minutesSinceLastPull: 45,
      remoteCommit: "abc",
      unintegratedPulls: 2,
      next: "snagentic integrate pdi",
    });
  });

  it("reports an interrupted full pull, which the next pull resumes", async () => {
    const checkpoint = {
      startedAt: "2026-10-06 08:00:00",
      completedClasses: ["a", "b"],
      records: 9,
    };
    const status = await instanceStatus("/w", "pdi", deps(null, checkpoint));
    expect(status).toMatchObject({
      phase: "interrupted",
      interrupted: { startedAt: "2026-10-06 08:00:00", completedClasses: 2 },
      next: "snagentic pull pdi",
    });
  });

  it("lists local changes to synced files", async () => {
    const view = { remoteCommit: "abc", unintegratedPulls: 0, localChanges: ["a.script.js"] };
    const status = await instanceStatus("/w", "pdi", deps(PULLED, null, view));
    expect(status).toMatchObject({ phase: "integrated", localChanges: ["a.script.js"] });
  });
});
