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

function fieldLoss(difference: Extract<Difference, { kind: "field" }>): LossId | null {
  if (API_DEFAULTS.has(`${difference.table}.${difference.field}`)) return "api-default";
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
export function knownLoss(difference: Difference): LossId | null {
  return difference.kind === "rows" ? rowsLoss(difference) : fieldLoss(difference);
}
