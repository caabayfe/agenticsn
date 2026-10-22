import { loneChoiceRefusal } from "./choice-list";
import { emptyLengthRefusal } from "./column-length";
import { compareUnit, type Difference } from "./compare";
import type { LedgerEntry } from "./ledger";
import { knownLoss, type LossId } from "./losses";
import { type BuiltUnit, type InstanceCopy, isDeletion } from "./unit";
import { unitSpec } from "./unit-specs";

// What plan does with one unit (ADR-0033 item 4).
export type UnitDecision =
  // The instance already holds what the build would load, or a deletion's record is gone.
  | { readonly kind: "none" }
  // The instance holds what the build would load, but the ledger does not say so (a push that
  // stopped part way, or the same change made on the instance): only the ledger is written.
  | { readonly kind: "record" }
  | { readonly kind: "create" }
  | {
      readonly kind: "load";
      readonly differences: readonly Difference[];
      // Differences that are known SDK losses: what the load also sets.
      readonly losses: readonly LossId[];
    }
  | { readonly kind: "delete" }
  // Someone changed the unit on the instance since it last agreed with source.
  | { readonly kind: "drift"; readonly differences: readonly Difference[] }
  // The instance holds the unit, and this branch never adopted it from this instance.
  | { readonly kind: "not-adopted"; readonly differences: readonly Difference[] }
  // The unit has rows in other domains, which a load might replace (S16), would replace a field's
  // choice list with one choice, or the platform would refuse the load while answering success
  // (a column with no max length).
  | { readonly kind: "unsafe"; readonly reason: string };

function lossesOf(differences: readonly Difference[], scope: string | undefined): LossId[] {
  const losses = new Set<LossId>();
  for (const difference of differences) {
    const loss = knownLoss(difference, scope);
    if (loss !== null) losses.add(loss);
  }
  return [...losses].sort();
}

function decideDeletion(copy: InstanceCopy | null, entry: LedgerEntry | undefined): UnitDecision {
  if (copy === null) return { kind: "none" };
  if (entry !== undefined && entry.instance !== copy.version) {
    return { kind: "drift", differences: [] };
  }
  return { kind: "delete" };
}

export function planUnit(
  unit: BuiltUnit,
  digest: string,
  copy: InstanceCopy | null,
  entry: LedgerEntry | undefined,
): UnitDecision {
  if (isDeletion(unit)) return decideDeletion(copy, entry);
  const lone = loneChoiceRefusal(unit);
  if (lone !== null) return { kind: "unsafe", reason: lone };
  if (copy === null) {
    // Adopted and then deleted on the instance: drift, not a silent re-create.
    return entry === undefined ? { kind: "create" } : { kind: "drift", differences: [] };
  }
  const comparable = unitSpec(unit.head.table).comparable;
  const differences = comparable ? compareUnit(unit, copy) : [];
  if (comparable && differences.length === 0) {
    const current = entry?.instance === copy.version && entry.build === digest;
    return current ? { kind: "none" } : { kind: "record" };
  }
  if (entry === undefined) return { kind: "not-adopted", differences };
  if (entry.instance !== copy.version) return { kind: "drift", differences };
  if (entry.build === digest) return { kind: "none" };
  return decideLoad(unit, copy, differences);
}

// A changed unit the branch adopted: loaded, unless the load would replace other domains' rows
// or the platform would refuse it while answering success.
function decideLoad(
  unit: BuiltUnit,
  copy: InstanceCopy,
  differences: readonly Difference[],
): UnitDecision {
  if (copy.foreignRows > 0) {
    return {
      kind: "unsafe",
      reason: `${copy.foreignRows} rows belong to other domains: it is never loaded`,
    };
  }
  const refused = emptyLengthRefusal(unit, copy);
  if (refused !== null) return { kind: "unsafe", reason: refused };
  return {
    kind: "load",
    differences,
    losses: lossesOf(differences, unit.head.fields["sys_scope"]),
  };
}
