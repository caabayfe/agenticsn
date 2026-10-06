// What runs on a table, by class: which field names the table, and how the platform orders
// it. Data, not special cases elsewhere (AGENTS.md: artifact types are registered).

export type Phase =
  | "client" // in the browser: client scripts, UI policies
  | "action" // UI actions offered on forms and lists
  | "before" // server, before the database write
  | "after" // server, after the write, same transaction
  | "async" // server, queued after the transaction
  | "display" // server, when a form is loaded
  | "query" // server, before a query (query business rules)
  | "access" // ACLs
  | "notify" // notifications
  | "policy" // data policies
  | "field"; // dictionary entries (the table's own fields)

export interface BehaviorClass {
  readonly kind: string;
  // The field holding the table name. ACLs hold "table" or "table.field" in their name.
  readonly tableField: string;
  readonly phase: (fields: Readonly<Record<string, string>>) => Phase;
  // How people refer to it, when its name field alone would mislead.
  readonly displayName?: (fields: Readonly<Record<string, string>>) => string;
}

const ALWAYS = (phase: Phase) => () => phase;

function businessRulePhase(fields: Readonly<Record<string, string>>): Phase {
  if (fields["action_query"] === "true") {
    return "query";
  }
  const when = fields["when"] ?? "";
  return when === "after" || when === "async" || when === "display" ? when : "before";
}

export const BEHAVIOR_CLASSES: Readonly<Record<string, BehaviorClass>> = {
  sys_script: { kind: "business rule", tableField: "collection", phase: businessRulePhase },
  sys_script_client: { kind: "client script", tableField: "table", phase: ALWAYS("client") },
  sys_ui_policy: { kind: "UI policy", tableField: "table", phase: ALWAYS("client") },
  sys_ui_action: { kind: "UI action", tableField: "table", phase: ALWAYS("action") },
  sys_security_acl: { kind: "ACL", tableField: "name", phase: ALWAYS("access") },
  sysevent_email_action: {
    kind: "notification",
    tableField: "collection",
    phase: ALWAYS("notify"),
  },
  sys_data_policy2: { kind: "data policy", tableField: "model_table", phase: ALWAYS("policy") },
  // A dictionary entry's `name` is its table: it is known as table.field.
  sys_dictionary: {
    kind: "field",
    tableField: "name",
    phase: ALWAYS("field"),
    displayName: (fields) => `${fields["name"] ?? ""}.${fields["element"] ?? ""}`,
  },
};

// The table a record acts on, or null when it is not table behavior.
export function behaviorTable(
  className: string,
  fields: Readonly<Record<string, string>>,
): string | null {
  const behavior = BEHAVIOR_CLASSES[className];
  const value = behavior === undefined ? "" : (fields[behavior.tableField] ?? "");
  if (value === "") {
    return null;
  }
  // ACL names are "table", "table.field" or "table.*".
  return className === "sys_security_acl" ? (value.split(".")[0] ?? "") : value;
}

// Execution order within a phase: the order field, then the name.
export function orderOf(fields: Readonly<Record<string, string>>): number {
  const order = Number(fields["order"]);
  return Number.isFinite(order) && fields["order"] !== "" ? order : 100;
}
