import { describe, expect, it } from "bun:test";
import {
  type CatalogData,
  completePull,
  PULL_CATALOG_FILE,
  PULL_STATE_FILE,
  type PullCheckpoint,
  recordPull,
  type SyncState,
  type SyncStateStore,
  signedState,
  stateInMirror,
} from "@snagentic/core";
import { memoryMirror } from "../support/memory-mirror";

const PULLED: SyncState = { watermark: "2026-10-05 11:00:00", lastFullPull: "2026-10-05 10:00:00" };
const CATALOG: CatalogData = {
  parents: { sys_script: "sys_metadata" },
  scopes: {},
  typedFields: {},
};
const PULLER = { user: "admin", version: "2.20.0" };

function localStore(options: { state?: SyncState; legacy?: boolean } = {}) {
  const calls: string[] = [];
  let checkpoint: PullCheckpoint | null = { startedAt: "x", completedClasses: [], records: 0 };
  const store: SyncStateStore = {
    readCatalog: async () => (options.legacy === true ? CATALOG : null),
    readState: async () => options.state ?? null,
    readCheckpoint: async () => checkpoint,
    writeCheckpoint: async (value) => {
      checkpoint = value;
    },
    clearCheckpoint: async () => {
      checkpoint = null;
      calls.push("clear checkpoint");
    },
    heldLocally: async () => options.legacy === true,
    noteUnchanged: async (state) => {
      calls.push(`note ${state.watermark}`);
    },
    forgetLocalState: async () => {
      calls.push("forget local state");
    },
    readTrust: async () => ({}),
    noteTrust: async () => {},
  };
  return { store, calls, checkpoint: () => checkpoint };
}

describe("the pull state in the mirror (ADR-0052)", () => {
  it("writes the catalog and the reached state into the pull's own commit", async () => {
    const { mirror, files } = memoryMirror();
    const state = stateInMirror(localStore().store, mirror, "instances/pdi");
    await state.writeCatalog(CATALOG);
    expect(await recordPull(state, PULLED, { full: true, idle: false, puller: PULLER })).toBe(true);
    expect(files.get(PULL_CATALOG_FILE)).toEqual(CATALOG);
    expect(files.get(PULL_STATE_FILE)).toEqual({
      ...PULLED,
      pulledBy: "admin",
      snagenticVersion: "2.20.0",
    });
    expect(await state.readState()).toMatchObject({ pulledBy: "admin" });
  });

  it("makes no commit for a pull that found nothing new, and notes the check locally", async () => {
    const { mirror, files } = memoryMirror();
    const local = localStore({ state: PULLED });
    const state = stateInMirror(local.store, mirror, "instances/pdi");
    const later = { ...PULLED, watermark: "2026-10-05 12:00:00" };
    expect(await recordPull(state, later, { full: false, idle: true, puller: PULLER })).toBe(false);
    expect(files.size).toBe(0);
    await completePull(state, false);
    expect(local.calls).toEqual(["note 2026-10-05 12:00:00", "clear checkpoint"]);
  });

  it("commits a publishing pull's later watermark even when nothing changed", async () => {
    const { mirror, files } = memoryMirror();
    const state = stateInMirror(localStore({ state: PULLED }).store, mirror, "instances/pdi");
    const run = { full: false, idle: true, publish: true, puller: PULLER };
    expect(await recordPull(state, PULLED, run)).toBe(true);
    expect(files.get(PULL_STATE_FILE)).toMatchObject(PULLED);
  });

  it("moves an earlier version's local state and catalog into the next pull commit", async () => {
    const { mirror, files } = memoryMirror();
    const local = localStore({ state: PULLED, legacy: true });
    const state = stateInMirror(local.store, mirror, "instances/pdi");
    expect(await recordPull(state, PULLED, { full: false, idle: true, puller: PULLER })).toBe(true);
    expect(files.get(PULL_CATALOG_FILE)).toEqual(CATALOG);
    expect(files.get(PULL_STATE_FILE)).toMatchObject(PULLED);
    await completePull(state, true);
    expect(local.calls).toEqual(["clear checkpoint", "forget local state"]);
  });

  it("keeps a catalog this pull refreshed rather than the one an earlier version kept", async () => {
    const { mirror, files } = memoryMirror();
    const state = stateInMirror(localStore({ legacy: true }).store, mirror, "instances/pdi");
    const fresh = { ...CATALOG, scopes: { s1: "x_app" } };
    await state.writeCatalog(fresh);
    await state.writeState(PULLED);
    expect(files.get(PULL_CATALOG_FILE)).toEqual(fresh);
  });

  it("names the full pull's user, and keeps it through other users' incremental pulls", () => {
    const full = signedState(PULLED, { full: true, puller: PULLER });
    expect(full.pulledBy).toBe("admin");
    const other = { user: "dev.one", version: "2.20.0" };
    expect(signedState(full, { full: false, puller: other }).pulledBy).toBe("admin");
    expect(signedState(PULLED, { full: false, puller: other }).pulledBy).toBe("dev.one");
    expect(signedState(full, { full: true, puller: other }).pulledBy).toBe("dev.one");
  });
});
