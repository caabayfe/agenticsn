import type { Difference } from "./compare";

// What the SDK is known to lose or change when it converts and rebuilds a record (S16, S17):
// differences `adopt` accepts and records, and plan lists as "the load also sets". Tied to the
// SDK version snagentic embeds; an upgrade re-runs the fixtures that prove each entry.

export const LOSSES_SDK_VERSION = "4.13.6";

export type LossId = "api-default" | "reference-display-value" | "script-format" | "form-columns";

export const LOSS_DESCRIPTIONS: Readonly<Record<LossId, string>> = {
  "api-default": "the SDK writes its API's default instead of the instance's value",
  "reference-display-value": "the SDK writes a reference's display value instead of its sys_id",
  "script-format": "the SDK reformats the script (whitespace only)",
  "form-columns": "Form() writes the section with column markers (.begin_split)",
};

// Fields whose value the SDK replaces with its API's default (table.field).
const API_DEFAULTS: ReadonlySet<string> = new Set([
  "sysevent_email_action.digest_separator_html",
  "sysevent_email_action.digest_separator_text",
  "sysauto_script.entered_time",
  "sysauto_script.entered_run_start",
  "sysauto_script.run_dayofweek",
  "sys_script.priority",
  "sys_dictionary.calculation",
]);

// Fields the conversion fixes write as the API's default where the instance holds nothing
// (conversion-fixes.ts): only that empty value is the loss, never a value the source changed.
const EMPTY_DEFAULTS: Readonly<Record<string, string>> = {
  "sys_ui_policy_action.field_message_type": "none",
  // An empty UI type is desktop's; the build writes desktop's id (spec 009 X4, 144 on pdi2).
  "sys_ui_policy.ui_type": "0",
  // The SDK's inbound action plugin reads an empty action as a record action (1 on pdi2).
  "sysevent_in_email_action.action": "record_action",
  // ApplicationMenu writes order 100 where a menu has none: 96 of 217 menus on pdi2, all
  // baseline. Accepted by the product owner (2026-10-17): adopt works, and every plan that loads
  // such a menu says the load also sets its order. Exact alternative: Record() (test plan,
  // decision 3).
  "sys_app_application.order": "100",
  // A UI policy with no script builds the SDK's empty condition function, which does nothing
  // either (26 on pdi2); an action with no visibility builds ignore, which empty means (1).
  "sys_ui_policy.script_true": "function onCondition() {\n\n}",
  "sys_ui_policy.script_false": "function onCondition() {\n\n}",
  "sys_ui_policy_action.visible": "ignore",
  // As for menus (product owner, 2026-10-18): 2 baseline UI actions on pdi2, each alone on its form.
  "sys_ui_action.order": "100",
};

// The same, for records of the global scope only: an empty access on a global table is what
// public means (975 global u_ tables on pdi2; no scoped table there has an empty access).
const GLOBAL_EMPTY_DEFAULTS: Readonly<Record<string, string>> = {
  "sys_db_object.access": "public",
};

// Values the instance writes another way for the same meaning: a column's choice 0 is "no
// choices", which the build writes empty (19 custom columns on pdi2).
const SAME_MEANING: Readonly<
  Record<string, { readonly built: string; readonly instance: string }>
> = {
  "sys_dictionary.choice": { built: "", instance: "0" },
};

// Fields the SDK computes from other fields, which only the instance's empty value may differ
// from: a global role's suffix becomes its name (632 of 646 global roles on pdi2 have none; 7
// already hold their name, so the platform accepts it).
// A policy action with no table builds its policy's table, which is what empty means (5 on pdi2).
const EMPTY_RECOMPUTED: ReadonlySet<string> = new Set([
  "sys_user_role.suffix",
  "sys_ui_policy_action.table",
]);

const SPLIT_MARKERS = /^(\.begin_split|\.split|\.end_split)\|/;
const SYS_ID = /^[0-9a-f]{32}$/;
const withoutSpace = (value: string) => value.replace(/\s+/g, "");

function rowsLoss(difference: Extract<Difference, { kind: "rows" }>): LossId | null {
  if (difference.table !== "sys_ui_element") return null;
  const columns = (keys: readonly string[]) => keys.filter((key) => !SPLIT_MARKERS.test(key));
  const built = columns(difference.built);
  const instance = columns(difference.instance);
  const same = built.length === instance.length && built.every((key, i) => key === instance[i]);
  return same ? "form-columns" : null;
}

function fieldLoss(
  difference: Extract<Difference, { kind: "field" }>,
  scope: string | undefined,
): LossId | null {
  const key = `${difference.table}.${difference.field}`;
  if (API_DEFAULTS.has(key)) return "api-default";
  const global = scope === "global" ? GLOBAL_EMPTY_DEFAULTS[key] : undefined;
  if (difference.instance === "" && global === difference.built) return "api-default";
  const same = SAME_MEANING[key];
  if (same?.built === difference.built && same.instance === difference.instance) {
    return "api-default";
  }
  if (difference.instance === "" && EMPTY_DEFAULTS[key] === difference.built) return "api-default";
  if (difference.instance === "" && EMPTY_RECOMPUTED.has(key)) return "api-default";
  if (
    SYS_ID.test(difference.instance) &&
    difference.built !== "" &&
    !SYS_ID.test(difference.built)
  ) {
    return "reference-display-value";
  }
  if (withoutSpace(difference.built) === withoutSpace(difference.instance)) return "script-format";
  return null;
}

// The known loss a difference is, or null when the difference is not explained.
// `scope`: the unit's application scope (its sys_scope), for losses that hold in global only.
export function knownLoss(difference: Difference, scope?: string): LossId | null {
  return difference.kind === "rows" ? rowsLoss(difference) : fieldLoss(difference, scope);
}
