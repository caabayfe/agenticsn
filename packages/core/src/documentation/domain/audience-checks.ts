import type { Evidence } from "./evidence";
import { proseOf } from "./page";
import type { View } from "./views";

// The tables behind what each reader sees: evidence from one of them shows a guide's steps were
// checked on the reader's own screen (spec 010a §3).
export const SURFACE_TABLES: Readonly<Record<View, readonly string[]>> = {
  user: [
    "sp_portal",
    "sp_page",
    "sp_instance",
    "sp_widget",
    "sp_rectangle_menu",
    "sp_rectangle_menu_item",
    "sp_page_route_map",
    "sn_ex_sp_portal_extensible_navigation",
    "sn_ex_sp_portal_extensible_navigation_item",
    "ticket_configuration",
    "ticket_tab_configuration",
    "std_ticket_config_action",
    "request_filter",
    "topic",
    "taxonomy",
    "sc_cat_item",
    "sc_cat_item_producer",
    "item_option_new",
    "sys_cs_topic",
    "sysevent_in_email_action",
    "sysevent_email_action",
    "asmt_metric_type",
    "asmt_metric",
    "asmt_condition",
  ],
  operator: [
    "sys_app_module",
    "sys_ux_list",
    "sys_ux_list_category",
    "sys_declarative_action_assignment",
    "sys_ux_form_action_layout",
    "sys_ui_section",
    "sys_ui_form",
    "sys_ui_view",
    "sys_ui_action",
    "sys_ui_policy",
    "sys_ui_policy_action",
    "sys_dictionary",
    "sys_documentation",
    "sys_choice_set",
    "sys_choice",
    "sysevent_email_action",
    "contract_sla",
  ],
};

const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const CODE = /\b[a-z][a-z_]*\s*!?=\s*\d+\b/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Platform words in prose meant for end users: table and field names, state codes, and the
// site's own list. A heuristic, so `docs check` warns and never blocks.
export function platformWords(markdown: string, extra: readonly string[]): readonly string[] {
  const prose = proseOf(markdown)
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>]+>/g, " ");
  const found = [...prose.matchAll(SNAKE), ...prose.matchAll(CODE)].map((match) => match[0]);
  for (const word of extra) {
    const match = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").exec(prose);
    if (match !== null) {
      found.push(match[0]);
    }
  }
  return [...new Set(found)];
}

// True when some evidence was checked where the reader works: a record of their surface's
// tables, or a person's check on the screen.
export function checkedOnSurface(evidence: readonly Evidence[], view: View): boolean {
  return evidence.some(
    (item) =>
      item.kind === "seen" || (item.kind === "record" && SURFACE_TABLES[view].includes(item.table)),
  );
}
