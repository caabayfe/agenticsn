import {
  compareFingerprint,
  FINGERPRINT_SOURCES,
  type FingerprintChange,
} from "../domain/fingerprint";
import { INVENTORY } from "../domain/inventory";
import type { Fingerprints, SyncState } from "../ports";
import { fetchFingerprints } from "./fetch-fingerprints";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { inventorySignatures } from "./pull-operational";

function compareAll(previous: Fingerprints | undefined, current: Fingerprints) {
  return new Map<string, FingerprintChange>(
    FINGERPRINT_SOURCES.map((table) => {
      const now = current[table];
      return [table, now === undefined ? "changed" : compareFingerprint(previous?.[table], now)];
    }),
  );
}

// Every direct child table is reconciled by grouped counts, as if it had lost rows.
function verifyAllChildren(
  changes: ReadonlyMap<string, FingerprintChange>,
): Map<string, FingerprintChange> {
  return new Map(
    [...changes].map(([table, change]) => [table, table === "sys_metadata" ? change : "shrunk"]),
  );
}

// What moved since the last pull: the change sources' fingerprints and the inventory's
// signals. The mirror tree is read only when something needs it.
export async function detectChanges(
  deps: IncrementalDependencies,
  state: SyncState,
  verify: boolean,
  signal: AbortSignal,
) {
  const current = await fetchFingerprints(deps.statistics, signal);
  const fingerprintChanges = compareAll(state.fingerprints, current.fingerprints);
  const changes = verify ? verifyAllChildren(fingerprintChanges) : fingerprintChanges;
  const inventory = await inventorySignatures(deps.statistics, signal);
  const stale = INVENTORY.filter(
    (source) =>
      verify ||
      (source.signal !== undefined &&
        inventory[source.file] !== undefined &&
        inventory[source.file] !== state.inventory?.[source.file]),
  );
  const moved = [...changes.values()].some((change) => change !== "unchanged");
  if (verify || moved || stale.length > 0) {
    await deps.records.prepare();
  }
  return { current, fingerprintChanges, changes, inventory, stale };
}
