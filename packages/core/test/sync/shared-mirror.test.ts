import { describe, expect, it } from "bun:test";
import {
  checkPublisher,
  continueFromNewest,
  isCurrent,
  type PullCheckpoint,
  removesByAbsence,
  type SharedMirror,
  SharedMirrorUnreachableError,
  type SharedTip,
  type SyncState,
  type SyncStateStore,
  sharedMirrorStatus,
} from "@snagentic/core";

const NOW = new Date("2026-11-10T12:00:00Z");
const SETTING = { remote: "origin", maxAgeMinutes: 15 };
const at = (watermark: string, pulledBy = "svc_ci"): SyncState => ({
  watermark,
  lastFullPull: "2026-11-01 00:00:00",
  pulledBy,
});

// A local branch at `local` (with its state), a remote at `shared`, and their history.
function world(options: {
  local: { commit: string; state: SyncState } | null;
  shared: SharedTip | null;
  history?: Record<string, readonly string[]>;
  checkpoint?: PullCheckpoint;
  // The shared commit this clone fetched before; null: it never fetched.
  known?: string | null;
}) {
  let tip = options.local?.commit ?? null;
  let checkpoint = options.checkpoint ?? null;
  const shared: SharedMirror = {
    fetch: async () => options.shared,
    lastFetched: async () => options.known ?? null,
    localTip: async () => tip,
    contains: async (_root, descendant, ancestor) =>
      descendant === ancestor || (options.history?.[descendant] ?? []).includes(ancestor),
    moveTo: async (_root, _instance, move) => {
      tip = move.commit;
    },
    publish: async () => "published",
  };
  const state: SyncStateStore = {
    readState: async () =>
      tip === options.local?.commit
        ? (options.local?.state ?? null)
        : (options.shared?.state ?? null),
    readCatalog: async () => null,
    readCheckpoint: async () => checkpoint,
    writeCheckpoint: async () => {},
    clearCheckpoint: async () => {
      checkpoint = null;
    },
    heldLocally: async () => false,
    noteUnchanged: async () => {},
    forgetLocalState: async () => {},
    readTrust: async () => ({}),
    noteTrust: async () => {},
  };
  const deps = { shared, state, now: () => NOW };
  return { deps, tip: () => tip, checkpoint: () => checkpoint };
}

describe("continueFromNewest (ADR-0052 item 2)", () => {
  it("moves a clone that never pulled to the shared mirror, and finds it current", async () => {
    const w = world({ local: null, shared: { commit: "s1", state: at("2026-11-10 11:50:00") } });
    const start = await continueFromNewest(w.deps, "/w", "pdi", SETTING);
    expect(start).toMatchObject({
      from: "shared",
      watermark: "2026-11-10 11:50:00",
      current: true,
    });
    expect(w.tip()).toBe("s1");
  });

  it("keeps the local branch when its watermark is the later one", async () => {
    const w = world({
      local: { commit: "l1", state: at("2026-11-10 11:00:00", "dev") },
      shared: { commit: "s1", state: at("2026-11-10 10:00:00") },
    });
    const start = await continueFromNewest(w.deps, "/w", "pdi", SETTING);
    expect(start).toMatchObject({ from: "local", current: false });
    expect(w.tip()).toBe("l1");
  });

  it("a publisher continues from the shared tip when its branch does not build on it", async () => {
    const w = world({
      local: { commit: "l1", state: at("2026-11-10 11:00:00") },
      shared: { commit: "s1", state: at("2026-11-10 10:00:00") },
      known: "s0",
    });
    expect(await continueFromNewest(w.deps, "/w", "pdi", SETTING, true)).toMatchObject({
      from: "shared",
    });
    const built = world({
      local: { commit: "l1", state: at("2026-11-10 11:00:00") },
      shared: { commit: "s1", state: at("2026-11-10 10:00:00") },
      history: { l1: ["s1"] },
    });
    expect(await continueFromNewest(built.deps, "/w", "pdi", SETTING, true)).toMatchObject({
      from: "local",
    });
  });

  it("drops an interrupted pull older than the shared mirror it moves to", async () => {
    const w = world({
      local: null,
      shared: { commit: "s1", state: at("2026-11-10 11:00:00") },
      checkpoint: { startedAt: "2026-11-09 08:00:00", completedClasses: [], records: 0 },
    });
    await continueFromNewest(w.deps, "/w", "pdi", SETTING);
    expect(w.checkpoint()).toBeNull();
  });

  it("stays local without a shared branch, or with one that carries no state", async () => {
    for (const shared of [null, { commit: "s1", state: null }]) {
      const w = world({ local: { commit: "l1", state: at("2026-11-10 11:59:00") }, shared });
      expect(await continueFromNewest(w.deps, "/w", "pdi", SETTING)).toMatchObject({
        from: "local",
        current: true,
      });
    }
  });
});

describe("shared mirror rules", () => {
  it("refuses to publish over a shared mirror another user pulled, except a new branch", async () => {
    const shared = world({
      local: null,
      shared: { commit: "s1", state: at("2026-11-10 11:00:00") },
    });
    const start = await continueFromNewest(shared.deps, "/w", "pdi", SETTING, true);
    expect(() => checkPublisher(start, "pdi", "dev.one")).toThrow(/pulled by svc_ci/);
    expect(() => checkPublisher(start, "pdi", "svc_ci")).not.toThrow();
    const none = world({ local: null, shared: null });
    const fresh = await continueFromNewest(none.deps, "/w", "pdi", SETTING, true);
    expect(() => checkPublisher(fresh, "pdi", "dev.one")).not.toThrow();
  });

  it("is never current with a watermark ahead of the clock, and removes by absence only for the mirror's user", () => {
    expect(isCurrent("2026-11-10 11:50:00", NOW, 15)).toBe(true);
    expect(isCurrent("2026-11-10 11:40:00", NOW, 15)).toBe(false);
    expect(isCurrent("2026-11-11 00:00:00", NOW, 15)).toBe(false);
    expect(removesByAbsence("svc_ci", "svc_ci")).toBe(true);
    expect(removesByAbsence(undefined, "dev")).toBe(true);
    expect(removesByAbsence("svc_ci", "dev")).toBe(false);
  });
});

describe("taking the shared tip without a rewritten history (SEC2-06)", () => {
  const behind = { commit: "l1", state: at("2026-11-10 10:00:00", "dev") };
  const newer = { commit: "s2", state: at("2026-11-10 11:50:00") };

  it("refuses to drop local commits before this clone ever fetched the shared mirror", async () => {
    const w = world({ local: behind, shared: newer });
    await expect(continueFromNewest(w.deps, "/w", "pdi", SETTING)).rejects.toMatchObject({
      code: "shared-mirror-diverged",
      message: expect.stringContaining("l1"),
    });
    expect(w.tip()).toBe("l1");
  });

  it("fast-forwards a clone that never fetched, when the shared tip builds on its branch", async () => {
    const w = world({ local: behind, shared: newer, history: { s2: ["l1"] } });
    expect(await continueFromNewest(w.deps, "/w", "pdi", SETTING)).toMatchObject({
      from: "shared",
    });
    expect(w.tip()).toBe("s2");
  });

  it("drops this clone's own unpublished pulls once it has fetched the shared mirror", async () => {
    const w = world({ local: behind, shared: newer, known: "s1" });
    expect(await continueFromNewest(w.deps, "/w", "pdi", SETTING)).toMatchObject({
      from: "shared",
    });
    expect(w.tip()).toBe("s2");
  });
});

describe("sharedMirrorStatus (ADR-0052 item 6)", () => {
  it("is ahead when the shared mirror holds pulls the local branch lacks, and current while young", async () => {
    const w = world({
      local: { commit: "l1", state: at("2026-11-10 10:00:00", "dev") },
      shared: { commit: "s2", state: at("2026-11-10 11:50:00") },
    });
    expect(await sharedMirrorStatus(w.deps, "/w", "pdi", SETTING)).toEqual({
      remote: "origin",
      maxAgeMinutes: 15,
      reachable: true,
      commit: "s2",
      ageMinutes: 10,
      ahead: true,
      current: true,
    });
    expect(w.tip()).toBe("l1");
  });

  it("is not ahead when the local branch already contains the shared tip", async () => {
    const w = world({
      local: { commit: "l2", state: at("2026-11-10 11:00:00", "dev") },
      shared: { commit: "s1", state: at("2026-11-10 10:00:00") },
      history: { l2: ["s1"] },
    });
    expect(await sharedMirrorStatus(w.deps, "/w", "pdi", SETTING)).toMatchObject({
      ahead: false,
      current: false,
    });
  });

  it("is not ahead of a local branch at the shared tip itself", async () => {
    const state = at("2026-11-10 11:55:00");
    const w = world({ local: { commit: "s1", state }, shared: { commit: "s1", state } });
    expect(await sharedMirrorStatus(w.deps, "/w", "pdi", SETTING)).toMatchObject({
      ahead: false,
      current: true,
    });
  });

  it("calls a watermark ahead of the clock not current, as pull does (QUAL2-04)", async () => {
    const future = { commit: "s1", state: at("2026-11-10 13:00:00") };
    const w = world({ local: null, shared: future });
    const status = await sharedMirrorStatus(w.deps, "/w", "pdi", SETTING);
    expect(status).toMatchObject({ ageMinutes: 0, current: false });
    const start = await continueFromNewest(
      world({ local: null, shared: future }).deps,
      "/w",
      "pdi",
      SETTING,
    );
    expect(start.current).toBe(status.current);
  });

  it("reports an unreachable remote without failing", async () => {
    const w = world({
      local: { commit: "l1", state: at("2026-11-10 11:55:00", "dev") },
      shared: null,
    });
    const deps = {
      ...w.deps,
      shared: {
        ...w.deps.shared,
        fetch: async () => {
          throw new SharedMirrorUnreachableError("origin", "no network");
        },
      },
    };
    expect(await sharedMirrorStatus(deps, "/w", "pdi", SETTING)).toMatchObject({
      reachable: false,
      ahead: false,
      current: true,
    });
  });
});
