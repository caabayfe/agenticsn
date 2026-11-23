import { compareUnit } from "./compare";
import type { PendingDelivery } from "./delivery-receipt";
import type { LedgerEntry } from "./ledger";
import { planUnit, type UnitDecision } from "./plan-unit";
import { type BuiltUnit, type InstanceCopy, isDeletion } from "./unit";
import { unitSpec } from "./unit-specs";

export const RECOVERY_GUIDE = "docs/guides/recover-interrupted-delivery.md";
// Said wherever recovery cannot finish an unfinished delivery: the reviewed way to drop it
// (ADR-0050, amendment A1).
export const ABANDON_PENDING_EXIT = `snagentic push --abandon-pending --plan <the unfinished push in snagentic status> drops this delivery without changing the instance, and lists what stays there (${RECOVERY_GUIDE})`;

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

const SOURCE_CHANGED = "source changed before its previous delivery was completed";
const SOURCE_CHANGED_NEXT = `if the instance already holds this build, review snagentic plan-push --recover-pending; otherwise restore the source that was pushed and plan again (${RECOVERY_GUIDE})`;
const INSTANCE_CHANGED = "the instance changed after the last known delivery version";
const INSTANCE_CHANGED_NEXT = `snagentic plan-push --recover-pending finishes it only if the instance holds exactly this build with its original capture; if that refuses, ${ABANDON_PENDING_EXIT}`;

const unsafe = (reason: string, next: string): UnitDecision => ({
  kind: "unsafe",
  reason: `unfinished delivery: ${reason}; ${next}`,
});

// Changed source may replace what the unfinished delivery wrote only while the record is at the
// version that delivery read back: nobody saved it since, so the load overwrites nothing but the
// push's own write (ADR-0050, amendment A2). A deletion, or a write whose outcome was never
// read, proves no such ownership.
function correctedDecision(
  unit: BuiltUnit,
  digest: string,
  copy: InstanceCopy | null,
  pending: PendingDelivery,
  entry: LedgerEntry | undefined,
): UnitDecision {
  const observed = pending.observed ?? null;
  if (pending.operation === "delete" || isDeletion(unit) || observed === null || copy === null)
    return unsafe(SOURCE_CHANGED, SOURCE_CHANGED_NEXT);
  if (copy.version !== observed) return unsafe(INSTANCE_CHANGED, INSTANCE_CHANGED_NEXT);
  const decision = planUnit(unit, digest, copy, {
    build: "",
    instance: observed,
    losses: entry?.losses ?? [],
  });
  // The instance already holds the corrected build: that is receipt-only recovery, not a load.
  if (decision.kind === "record") return unsafe(SOURCE_CHANGED, SOURCE_CHANGED_NEXT);
  return decision.kind === "load" ? { ...decision, replacesUnfinished: true } : decision;
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
  if (digest !== pending.digest) return correctedDecision(unit, digest, copy, pending, entry);
  const version = copy?.version ?? null;
  const expected = pending.observed === undefined ? pending.before : pending.observed;
  if (version !== expected) {
    const proven =
      pending.observed === undefined &&
      copy !== null &&
      unitSpec(unit.head.table).comparable &&
      compareUnit(unit, copy).length === 0;
    if (!proven) return unsafe(INSTANCE_CHANGED, INSTANCE_CHANGED_NEXT);
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
