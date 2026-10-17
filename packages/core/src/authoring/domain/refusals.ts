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
  // The same for a protected UI policy's actions (34 on pdi2), refused alike (2026-10-17).
  {
    table: "sys_ui_policy_action",
    field: "sys_policy",
    applies: (built, instance) => built !== "" && instance === "",
    reason: (built) =>
      `a protected UI policy: the SDK would mark its actions read-only (sys_policy = ${built}), which changes who may edit them; leave the policy on the instance`,
  },
  // UiPolicy drops the UI type of a policy that runs no scripts and builds desktop (29 on pdi2).
  {
    table: "sys_ui_policy",
    field: "ui_type",
    applies: (built, instance) => instance !== "" && built !== instance,
    reason: () =>
      "a UI policy that runs no scripts would apply only on desktop: the SDK drops its UI type; leave it on the instance",
  },
];

// What the SDK's conversion can't make, by its error: the reason and what to set (spec 009 L1).
const CONVERSION_REFUSALS: readonly { readonly error: RegExp; readonly reason: string }[] = [
  // A UI policy that runs scripts with an empty UI type (5 on pdi2): the SDK reads it as a number.
  {
    error: /^Cannot coerce value to number/,
    reason:
      "the SDK can't convert a number field left empty (a UI policy that runs scripts: its UI type); set it on the instance, then adopt again",
  },
];

export function conversionRefusal(message: string): string | null {
  return CONVERSION_REFUSALS.find((refusal) => refusal.error.test(message))?.reason ?? null;
}

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
