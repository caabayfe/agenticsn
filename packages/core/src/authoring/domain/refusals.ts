import type { Difference } from "./compare";

// Differences adopt refuses by design, each with its reason (spec 009 test plan, L1): what the
// SDK would change is not cosmetic, and the product owner chose not to accept it.

interface Refusal {
  readonly table: string;
  readonly field: string;
  // Whether the difference is this refusal's case.
  readonly applies: (built: string, instance: string) => boolean;
  readonly reason: (built: string) => string;
}

const REFUSALS: readonly Refusal[] = [
  // The SDK copies a protected role's policy to its containment rows; on the instance some have
  // none (6 ServiceNow roles on pdi2). Protecting them changes who may edit the role's grants
  // (product owner, 2026-10-17).
  {
    table: "sys_user_role_contains",
    field: "sys_policy",
    applies: (built, instance) => built !== "" && instance === "",
    reason: (built) =>
      `a protected role: the SDK would mark its containment rows read-only (sys_policy = ${built}), which changes who may edit its grants; leave the role on the instance`,
  },
];

// The reason a difference is refused by design, or null.
export function knownRefusal(difference: Difference): string | null {
  if (difference.kind !== "field") return null;
  const refusal = REFUSALS.find(
    (r) =>
      r.table === difference.table &&
      r.field === difference.field &&
      r.applies(difference.built, difference.instance),
  );
  return refusal === undefined ? null : refusal.reason(difference.built);
}
