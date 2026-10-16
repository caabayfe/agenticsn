import type { Ledger } from "./ledger";

// A record a pull changed, as the mirror holds it: its update name and its stamp.
export interface PulledRecord {
  readonly updateName: string;
  readonly modCount: string;
  readonly updatedOn: string;
}

// Adopted units a pull shows changed on the instance since they last agreed with source
// (ADR-0033): early notice, before plan refuses them. A unit the ledger already holds at that
// stamp is this branch's own push coming back.
export function driftedUnits(
  pulled: readonly PulledRecord[],
  ledgers: readonly Ledger[],
  instance: string,
): string[] {
  const entries = new Map(ledgers.flatMap((ledger) => [...(ledger.get(instance) ?? [])]));
  return pulled
    .filter((record) => {
      const entry = entries.get(record.updateName);
      if (entry === undefined) return false;
      const [modCount = "", updatedOn = ""] = entry.instance.split("|");
      return modCount !== record.modCount || updatedOn !== record.updatedOn;
    })
    .map((record) => record.updateName)
    .sort();
}
