import type { CatalogData } from "../../metadata/domain/catalog";
import { PULL_CATALOG_FILE, PULL_STATE_FILE, type Puller, signedState } from "../domain/pull-state";
import type { MirrorWriter, PullStateStore, SyncState, SyncStateStore } from "../ports";

// The store a pull writes through (ADR-0052 item 1): its catalog and state go into the pull's own
// mirror commit. Reads return what this pull wrote, then the state it continues from.
export function stateInMirror(
  store: SyncStateStore,
  mirror: MirrorWriter,
  instanceRoot: string,
): PullStateStore {
  let catalog: CatalogData | null = null;
  let state: SyncState | null = null;
  const writeCatalog = async (data: CatalogData) => {
    catalog = data;
    await mirror.writeDocument(instanceRoot, PULL_CATALOG_FILE, data);
  };
  return {
    readCatalog: async () => catalog ?? store.readCatalog(),
    readState: async () => state ?? store.readState(),
    readCheckpoint: () => store.readCheckpoint(),
    writeCheckpoint: (checkpoint) => store.writeCheckpoint(checkpoint),
    clearCheckpoint: () => store.clearCheckpoint(),
    heldLocally: () => store.heldLocally(),
    noteUnchanged: (next) => store.noteUnchanged(next),
    forgetLocalState: () => store.forgetLocalState(),
    writeCatalog,
    async writeState(next) {
      // A workspace an earlier version pulled kept its catalog locally: this commit carries it.
      const kept =
        catalog === null && (await store.heldLocally()) ? await store.readCatalog() : null;
      if (kept !== null) await writeCatalog(kept);
      state = next;
      await mirror.writeDocument(instanceRoot, PULL_STATE_FILE, next);
    },
  };
}

export interface PullRun {
  readonly full: boolean;
  // An incremental pull that found nothing to change in the mirror.
  readonly idle: boolean;
  // The pull publishes to the shared mirror: its commit carries the later watermark even when
  // nothing changed, so the team's pulls inside maxAge ask the instance nothing (ADR-0052).
  readonly publish?: boolean;
  readonly puller: Puller;
}

// Called before the mirror commit: the reached state goes into it. A pull that found nothing new
// makes no commit: this clone notes the check instead. Returns whether the commit carries the
// state, which completePull needs.
export async function recordPull(
  state: PullStateStore,
  next: SyncState,
  run: PullRun,
): Promise<boolean> {
  const signed = signedState(next, run);
  if (run.idle && !run.full && run.publish !== true && !(await state.heldLocally())) {
    await state.noteUnchanged(signed);
    return false;
  }
  await state.writeState(signed);
  return true;
}

// Called once the mirror commit is durable: until then the checkpoint stands and a new run
// resumes, and an earlier version's local state stays where the next pull finds it.
export async function completePull(state: SyncStateStore, carried: boolean): Promise<void> {
  await state.clearCheckpoint();
  if (carried) await state.forgetLocalState();
}
