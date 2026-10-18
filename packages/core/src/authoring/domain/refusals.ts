import type { Difference } from "./compare";

// Differences adopt refuses by design, each with its reason (spec 009 test plan, L1): what the
// SDK would change is not cosmetic, and the product owner chose not to accept it.

interface Refusal {
  readonly table: string;
  readonly field: string;
  // Whether the difference is this refusal's case.
  readonly applies: (built: string, instance: string) => boolean;
  readonly reason: (built: string, instance: string) => string;
}

const REFUSALS: readonly Refusal[] = [
  // The SDK copies a protected role's policy to its containment rows; on the instance some have
  // none (6 ServiceNow roles on pdi2). Protecting them changes who may edit the role's grants
  // (product owner, 2026-10-17).
  {
    table: "sys_user_role_contains",
    field: "sys_policy",
    applies: (built, instance) => built !== instance,
    reason: (built, instance) =>
      `a protected role: the SDK would change its containment rows' protection from ${instance || "none"} to ${built || "none"} (read-only rows), which changes who may edit its grants; leave the role on the instance`,
  },
  // The same for a protected UI policy's actions (34 on pdi2), refused alike (2026-10-17).
  {
    table: "sys_ui_policy_action",
    field: "sys_policy",
    applies: (built, instance) => built !== instance,
    reason: (built, instance) =>
      `a protected UI policy: the SDK would change its actions' protection from ${instance || "none"} to ${built || "none"}, which changes who may edit them; leave the policy on the instance`,
  },
  // The same for a protected UI action's roles and views (25 on pdi2).
  ...["sys_ui_action_role", "sys_ui_action_view"].map(
    (table): Refusal => ({
      table,
      field: "sys_policy",
      applies: (built, instance) => built !== instance,
      reason: (built, instance) =>
        `a protected UI action: the SDK would change the protection of its ${table === "sys_ui_action_role" ? "roles" : "views"} from ${instance || "none"} to ${built || "none"}, which changes who may edit them; leave the action on the instance`,
    }),
  ),
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
      "the SDK can't convert a number field left empty (for a UI policy that runs scripts, its UI type): set a value on the instance, then adopt again",
  },
  // Legacy values the SDK's types reject: protection read-only or true (modules, UI actions,
  // script includes) and script include access private (6 on pdi2).
  {
    error: /Type '"(read-only|read_only|true|private)"' is not assignable/,
    reason:
      "the record holds a legacy value the SDK doesn't accept (protection read-only or true, or access private): set a current value on the instance, then adopt again",
  },
  // A combination of a UI action's workspace settings the SDK can't build (6 on pdi2).
  {
    error: /showFormButtonV2 or workspace\.showFormMenuButtonV2 must be true/,
    reason:
      "a UI action whose workspace settings the SDK can't express (a workspace action with neither form button nor form menu): adjust them on the instance, then adopt again",
  },
  // A baseline table's column: Table() defines only u_ tables in global (every sampled baseline
  // column on pdi2). A Record() route for baseline records is test plan decision 3.
  {
    error: /Global table 'name' property should start with custom prefix 'u_'/,
    reason:
      "a column of a baseline table, which the SDK's Table() can't define in global: leave it on the instance (a Record() route for baseline records is test plan decision 3)",
  },
  // An application's own table defines its choices with its column, not as a ChoiceSet (1 on pdi2).
  {
    error: /ChoiceSet on table '[^']*' is not allowed from scoped app/,
    reason:
      "the choices of a table its application owns are defined with the table's column: adopt the column (its sys_dictionary entry) instead",
  },
  // The SDK requires a UI policy's short description; 12 on pdi2 have none.
  {
    error: /shortDescription cannot be empty/,
    reason:
      "a UI policy with no short description, which the SDK requires: set one on the instance, then adopt again",
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
  return refusal === undefined ? null : refusal.reason(difference.built, difference.instance);
}
