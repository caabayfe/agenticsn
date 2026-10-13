import type { PlannedWrite } from "./change";

// What other records refer to is written first: a table before its fields and choices, a
// role before the ACLs that grant it, a UI policy before its actions, an event before the
// notification it sends, a form section, list or form before its rows (ADR-0025). ACLs come last: they are written through an elevated session
// (ADR-0024), and nothing refers to them. Everything else keeps path order, so the plan id
// stays stable.
const RANK: Readonly<Record<string, number>> = {
  sys_db_object: 0,
  sys_dictionary: 1,
  sys_documentation: 2,
  sys_choice: 2,
  sys_user_role: 3,
  sys_user_role_contains: 4,
  sys_ui_policy_action: 7,
  sys_ui_element: 7,
  sys_ui_list_element: 7,
  sys_ui_form_section: 7,
  sys_ui_related_list_entry: 7,
  sys_ui_action_view: 7,
  sysevent_email_action: 7,
  sys_security_acl: 8,
  sys_security_acl_role: 9,
};
const DEFAULT_RANK = 6;

const rankOf = (write: PlannedWrite) => RANK[write.table] ?? DEFAULT_RANK;

export function writeOrder(writes: readonly PlannedWrite[]): PlannedWrite[] {
  return [...writes].sort(
    (a, b) => rankOf(a) - rankOf(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

// A push stopped part way until a pull moves the mirror past the commit it started from.
export function pushUnfinished(
  journal: { readonly mirrorCommit: string } | null,
  mirrorCommit: string,
): boolean {
  return journal !== null && journal.mirrorCommit === mirrorCommit;
}
