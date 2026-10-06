// ServiceNow practice the engine gives agents through advise, ported from v1's skills. Each
// entry has a stable id, the situations it applies to, and the rules it relates to.

export type WorkPhase = "design" | "build" | "review";

export interface Guidance {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly phases: readonly WorkPhase[];
  // Applies when the work involves one of these classes, or one of these intents; to every
  // case when neither is given.
  readonly classes?: readonly string[];
  readonly intents?: readonly string[];
  readonly rules?: readonly string[];
}

const BR = ["sys_script"];
const CLIENT = ["sys_script_client", "catalog_script_client", "sys_ui_policy"];
const SI = ["sys_script_include"];
const ALL: readonly WorkPhase[] = ["design", "build", "review"];

export const GUIDANCE: readonly Guidance[] = [
  // Design (v1 servicenow-architect).
  {
    id: "SN-ADV-DES-001",
    title: "Least custom first",
    text: "Prefer out-of-box capability or configuration (plugin, property, choice, layout, assignment or approval rule, SLA, notification), then declarative/low-code (UI policy, data policy, dictionary or reference qualifier, flow, decision table), and script only when those cannot express it. Justify every option you skip; 'faster to write' is not a reason.",
    phases: ["design"],
  },
  {
    id: "SN-ADV-DES-002",
    title: "Do not edit baseline records",
    text: "Never edit an out-of-box record you can add to: deactivate and copy, add a new business rule with an order, extend a script include, or add a new UI action.",
    phases: ["design", "build"],
    rules: ["SN-UPG-002"],
  },
  {
    id: "SN-ADV-DES-003",
    title: "Scope new features",
    text: "New applications or clearly separable features belong in a scoped application, not in new global records.",
    phases: ["design"],
  },
  {
    id: "SN-ADV-DES-004",
    title: "Extend tables deliberately",
    text: "Extend task or cmdb_ci only when the new record is one of them; otherwise create a table in the app scope. Prefer extending over adding many fields to a baseline table.",
    phases: ["design"],
  },
  {
    id: "SN-ADV-DES-005",
    title: "Nothing hardcoded",
    text: "No hardcoded sys_ids, URLs or credentials: system properties, lookups by stable keys, Connection & Credential aliases.",
    phases: ALL,
    rules: ["SN-MNT-001", "SN-MNT-002", "SN-SEC-002"],
  },
  // Server scripting (v1 servicenow-server-scripting).
  {
    id: "SN-ADV-SRV-001",
    title: "Choose business rule timing deliberately",
    text: "before: change fields on current (never current.update()); after: update other records that must be consistent in the same transaction; async: anything slow or remote; display: only fill g_scratchpad for client scripts.",
    phases: ["design", "build"],
    classes: BR,
    rules: ["SN-PERF-001", "SN-PERF-007"],
  },
  {
    id: "SN-ADV-SRV-002",
    title: "Filter in the condition, keep rules thin",
    text: "Put the filter in the rule's condition, not in an if around the script, so the rule is skipped without compiling it. Wrap the script in the default IIFE and call a script include for anything reusable.",
    phases: ["build", "review"],
    classes: BR,
  },
  {
    id: "SN-ADV-SRV-003",
    title: "Query efficiently",
    text: "addQuery(field, operator, value) per condition; one query instead of one per row (IN, GlideAggregate, addJoinQuery); count with GlideAggregate; setLimit when you need only some rows; get() for single records and check its result.",
    phases: ["build", "review"],
    classes: [...BR, ...SI, "sysauto_script", "sys_ws_operation"],
    rules: ["SN-SEC-003", "SN-PERF-002", "SN-PERF-003"],
  },
  {
    id: "SN-ADV-SRV-004",
    title: "Script include shape",
    text: "Class name equals the record name. Client-callable includes extend global.AbstractAjaxProcessor, validate every getParameter() value, check roles, and return only what the caller needs. Keep includes 'This application scope only' unless they are an API.",
    phases: ["build", "review"],
    classes: SI,
    rules: ["SN-MNT-005"],
  },
  {
    id: "SN-ADV-SRV-005",
    title: "Log and fail clearly",
    text: "Log with a source prefix and no personal or secret data; try/catch around integration and parsing code without swallowing errors; user messages through gs.addErrorMessage(gs.getMessage(key)).",
    phases: ["build"],
    classes: [...BR, ...SI],
    rules: ["SN-MNT-003"],
  },
  // Client and UX (v1 servicenow-client-ux).
  {
    id: "SN-ADV-CLI-001",
    title: "Choose the client tool",
    text: "Field state by values: UI policy. Mandatory for every channel: data policy. Defaults: dictionary default or template. Reference choices: reference qualifier. Server data on load: display business rule and g_scratchpad. Server data on change: GlideAjax with getXMLAnswer(callback). Messages: showFieldMsg, addErrorMessage, GlideModal.",
    phases: ["design", "build"],
    classes: CLIENT,
    rules: ["SN-UX-002"],
  },
  {
    id: "SN-ADV-CLI-002",
    title: "Client scripts that survive upgrades",
    text: "No GlideRecord, synchronous calls, DOM, jQuery or gel() in the browser; only g_form, g_user, g_list and GlideModal. Set Isolate script on new client scripts; guard onChange with isLoading; no alert() or confirm(); set the UI type deliberately and test in Workspaces.",
    phases: ["build", "review"],
    classes: CLIENT,
    rules: ["SN-PERF-005", "SN-PERF-006", "SN-UPG-001", "SN-UX-001", "SN-UX-003"],
  },
  // Security (v1 servicenow-security).
  {
    id: "SN-ADV-SEC-001",
    title: "Every new table gets ACLs",
    text: "read, write, create and delete ACLs (and field ACLs for sensitive fields) for every new table. Roles first, then conditions, script only when needed. Grant roles to groups, never users; deny by default.",
    phases: ["design", "build", "review"],
    classes: ["sys_db_object", "sys_security_acl"],
    rules: ["SN-SEC-004"],
  },
  {
    id: "SN-ADV-SEC-002",
    title: "Code that exposes data",
    text: "Client-callable includes: isPublic() false, check roles and canRead() on every method, validate input, return only needed fields. Scripted REST: authenticated, ACL-protected, validated, GlideRecordSecure, explicit status codes. Escape user data in Jelly and portal templates.",
    phases: ["design", "build", "review"],
    classes: [...SI, "sys_ws_operation", "sp_widget"],
    rules: ["SN-SEC-001", "SN-SEC-003"],
  },
  // Integrations and background work (v1 servicenow-integrations).
  {
    id: "SN-ADV-INT-001",
    title: "Outbound calls",
    text: "Prefer IntegrationHub spokes or flow actions. If scripting, use a REST Message with a Connection & Credential alias; never call out from a before or display business rule; handle non-2xx and timeouts; log status and correlation ids, not bodies; use a MID Server for on-premise targets.",
    phases: ["design", "build"],
    classes: ["sys_rest_message", "sys_hub_action_type_definition"],
    intents: ["integration"],
    rules: ["SN-PERF-007", "SN-SEC-002", "SN-MNT-002"],
  },
  {
    id: "SN-ADV-INT-002",
    title: "Inbound data",
    text: "Use Import Sets and transform maps (or IntegrationHub ETL) rather than writing target tables directly; coalesce on stable keys.",
    phases: ["design"],
    classes: ["sys_transform_map"],
    intents: ["integration"],
  },
  {
    id: "SN-ADV-INT-003",
    title: "Background work",
    text: "Decouple slow work with gs.eventQueue and script actions; scheduled jobs are bounded, idempotent and restartable; no gs.sleep(); avoid setWorkflow(false).",
    phases: ["design", "build"],
    classes: ["sysauto_script", "sysevent_script_action"],
    intents: ["schedule"],
    rules: ["SN-PERF-004", "SN-MNT-004"],
  },
  // Review (v1 servicenow-reviewer manual checklist).
  {
    id: "SN-ADV-REV-001",
    title: "Review what checks cannot see",
    text: "Was a declarative option available? Is reusable logic in a script include? Right scope? New tables and endpoints protected? Business rule conditions set; queries on indexed fields with setLimit; choice values not labels; reference fields not strings; dates via GlideDateTime; descriptions filled; messages translatable; an ATF test or clear manual steps exist.",
    phases: ["review"],
  },
];

// Guidance for a phase of work on records of these classes, or for these intents (general
// guidance always).
export function guidanceFor(
  phase: WorkPhase,
  classes: readonly string[],
  intents: readonly string[] = [],
): Guidance[] {
  return GUIDANCE.filter((g) => {
    if (!g.phases.includes(phase)) {
      return false;
    }
    const general = g.classes === undefined && g.intents === undefined;
    const byClass = g.classes?.some((c) => classes.includes(c)) ?? false;
    const byIntent = g.intents?.some((i) => intents.includes(i)) ?? false;
    return general || byClass || byIntent;
  });
}
