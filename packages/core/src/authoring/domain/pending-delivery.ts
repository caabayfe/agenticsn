import { compareUnit } from "./compare";
import type { PendingDelivery } from "./delivery-receipt";
import type { LedgerEntry } from "./ledger";
import { planUnit, type UnitDecision } from "./plan-unit";
import { type BuiltUnit, type InstanceCopy, isDeletion } from "./unit";
import { unitSpec } from "./unit-specs";

export function isKeyedDeletion(unit: BuiltUnit): boolean {
  return (
    isDeletion(unit) && Object.keys(unit.head.fields).some((field) => !field.startsWith("sys_"))
  );
}

export function pendingFor(
  pending: readonly PendingDelivery[],
  unit: BuiltUnit,
  digest: string,
): PendingDelivery | undefined {
  const exact = pending.find((entry) => entry.updateName === unit.updateName);
  if (exact !== undefined) return exact;
  // Only deletions by keys receive a regenerated synthetic update name. A deletion by ID
  // must never borrow another record's receipt, even if their deletion digests are equal.
  return isKeyedDeletion(unit)
    ? pending.find((entry) => entry.operation === "delete" && entry.digest === digest)
    : undefined;
}

// An observed write is owned only while its version is unchanged. With no read-back (a
// timeout/crash), comparable content can reconcile the outcome; compiled content cannot.
export function pendingDecision(
  unit: BuiltUnit,
  digest: string,
  copy: InstanceCopy | null,
  pending: PendingDelivery,
  entry: LedgerEntry | undefined,
): UnitDecision {
  const unsafe = (reason: string): UnitDecision => ({
    kind: "unsafe",
    reason: `unfinished delivery: ${reason}; inspect the journal and target update set before reconciling`,
  });
  if (digest !== pending.digest)
    return unsafe("source changed before its previous delivery was completed");
  const version = copy?.version ?? null;
  const expected = pending.observed === undefined ? pending.before : pending.observed;
  if (version !== expected) {
    const proven =
      pending.observed === undefined &&
      copy !== null &&
      unitSpec(unit.head.table).comparable &&
      compareUnit(unit, copy).length === 0;
    if (!proven) return unsafe("the instance changed after the last known delivery version");
  }
  if (pending.verified === true) return { kind: "record" };
  if (isDeletion(unit)) return { kind: "delete" };
  const decision = planUnit(unit, digest, copy, {
    build: "",
    instance: version ?? "",
    losses: entry?.losses ?? [],
  });
  return decision.kind === "record"
    ? { kind: "load", differences: [], losses: entry?.losses ?? [] }
    : decision;
}
