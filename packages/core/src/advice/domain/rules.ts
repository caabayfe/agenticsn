// The ServiceNow rules snagentic checks (validate) and cites (advise). Ids are stable and
// never reused (AGENTS.md). Categories follow ServiceNow Instance Scan. Ported from v1.

export type RuleCategory =
  | "security"
  | "performance"
  | "upgradability"
  | "manageability"
  | "user_experience";
export type Severity = "block" | "warn" | "info";
// Where a rule's script applies: server-side scripts, form (client) scripts, portal client code.
export type ScriptKind = "server" | "client" | "portal_client";

export interface Rule {
  readonly id: string;
  readonly category: RuleCategory;
  readonly severity: Severity;
  readonly title: string;
  readonly why: string;
  readonly remediation: string;
  readonly scripts: readonly ScriptKind[];
  // Only records of these classes; any class with matching scripts when absent.
  readonly classes?: readonly string[];
}

const SERVER: readonly ScriptKind[] = ["server"];
const CLIENT: readonly ScriptKind[] = ["client"];
const BROWSER: readonly ScriptKind[] = ["client", "portal_client"];
const ANY: readonly ScriptKind[] = ["server", "client", "portal_client"];
const CLIENT_SCRIPTS = ["sys_script_client", "catalog_script_client"];

export const RULES: readonly Rule[] = [
  {
    id: "SN-SEC-001",
    category: "security",
    severity: "block",
    title: "No dynamic code evaluation",
    why: "eval, GlideEvaluator and new Function run strings as code, turning any attacker-controlled value into code execution.",
    remediation: "Call the intended function directly, or map allowed inputs to handlers.",
    scripts: ANY,
  },
  {
    id: "SN-SEC-002",
    category: "security",
    severity: "block",
    title: "No credentials in scripts",
    why: "Secrets in scripts end up in update sets, clones, source control and XML exports.",
    remediation: "Use a Connection & Credential alias, a credential record or a password2 field.",
    scripts: ANY,
  },
  {
    id: "SN-SEC-003",
    category: "security",
    severity: "warn",
    title: "Do not concatenate encoded queries",
    why: "Values containing '^', '^OR' or '^NQ' change an encoded query and can widen the result set (query injection).",
    remediation: "Use addQuery(field, operator, value) per condition, or GlideQuery.",
    scripts: SERVER,
  },
  {
    id: "SN-SEC-004",
    category: "security",
    severity: "warn",
    title: "ACL scripts must not grant unconditionally",
    why: "An ACL whose script always returns true adds no protection: access depends only on roles and conditions, and on nothing at all when neither is set.",
    remediation: "Remove the script and rely on roles/conditions, or test a real condition.",
    scripts: SERVER,
    classes: ["sys_security_acl"],
  },
  {
    id: "SN-SEC-005",
    category: "security",
    severity: "block",
    title: "No Packages.* Java calls",
    why: "Packages calls bypass the platform API contract, are blocked in scoped apps and break on upgrade.",
    remediation: "Use the documented Glide API equivalent.",
    scripts: SERVER,
  },
  {
    id: "SN-PERF-001",
    category: "performance",
    severity: "block",
    title: "No current.update() in before/after business rules",
    why: "Before rules save current automatically; in after rules update() triggers the whole rule chain again and can recurse.",
    remediation:
      "Set fields on current in a before rule. For after rules, update other records or use an async rule.",
    scripts: SERVER,
    classes: ["sys_script"],
  },
  {
    id: "SN-PERF-002",
    category: "performance",
    severity: "warn",
    title: "No queries inside loops",
    why: "One query per iteration (N+1) multiplies database round trips.",
    remediation: "Query once with an IN condition, use GlideAggregate, or a join (addJoinQuery).",
    scripts: SERVER,
  },
  {
    id: "SN-PERF-003",
    category: "performance",
    severity: "warn",
    title: "Avoid getRowCount()",
    why: "getRowCount() retrieves all matching rows to count them.",
    remediation: "Use GlideAggregate with COUNT, or setLimit(1) and hasNext() for existence.",
    scripts: SERVER,
  },
  {
    id: "SN-PERF-004",
    category: "performance",
    severity: "warn",
    title: "No gs.sleep()",
    why: "Sleeping holds a scarce worker or semaphore thread.",
    remediation: "Schedule the follow-up work (scheduled job, event, flow wait).",
    scripts: SERVER,
  },
  {
    id: "SN-PERF-005",
    category: "performance",
    severity: "block",
    title: "No GlideRecord in client scripts",
    why: "Client GlideRecord makes synchronous calls and exposes whole records to the browser.",
    remediation:
      "Use GlideAjax with an asynchronous callback, g_scratchpad from a display rule, or a UI policy.",
    scripts: CLIENT,
  },
  {
    id: "SN-PERF-006",
    category: "performance",
    severity: "warn",
    title: "No synchronous client calls",
    why: "getXMLWait() and getReference() without a callback freeze the form.",
    remediation: "Use getXMLAnswer()/getXML() or getReference(field, callback).",
    scripts: BROWSER,
  },
  {
    id: "SN-PERF-007",
    category: "performance",
    severity: "warn",
    title: "No outbound calls in before/display business rules",
    why: "A synchronous integration call holds the user's transaction open and fails the save when the endpoint is slow.",
    remediation:
      "Use an async business rule, an event and script action, or a Flow/IntegrationHub action.",
    scripts: SERVER,
    classes: ["sys_script"],
  },
  {
    id: "SN-UPG-001",
    category: "upgradability",
    severity: "block",
    title: "No DOM manipulation in client scripts",
    why: "Form HTML is not an API; direct DOM/jQuery access breaks on upgrade and in Workspaces.",
    remediation: "Use the g_form/g_list/GlideModal APIs or a UI policy.",
    scripts: CLIENT,
  },
  {
    id: "SN-UPG-002",
    category: "upgradability",
    severity: "info",
    title: "Prefer not to modify out-of-box records",
    why: "Customized baseline records are skipped on upgrade and must be reconciled.",
    remediation: "Deactivate and copy, extend, or add a new record with a higher order instead.",
    scripts: [],
  },
  {
    id: "SN-MNT-001",
    category: "manageability",
    severity: "warn",
    title: "No hardcoded sys_ids",
    why: "sys_ids differ across instances for data records and make intent unreadable.",
    remediation: "Use a system property, a lookup by a stable key, or a reference field.",
    scripts: ANY,
  },
  {
    id: "SN-MNT-002",
    category: "manageability",
    severity: "warn",
    title: "No hardcoded instance URLs",
    why: "Hardcoded URLs point at the wrong instance after clones and promotion.",
    remediation: "Use gs.getProperty('glide.servlet.uri') or a system property.",
    scripts: ANY,
  },
  {
    id: "SN-MNT-003",
    category: "manageability",
    severity: "warn",
    title: "Use gs.info/warn/error in scoped apps",
    why: "gs.log() and gs.print() are unavailable in scoped applications.",
    remediation: "Use gs.info(), gs.warn(), gs.error() or gs.debug().",
    scripts: SERVER,
  },
  {
    id: "SN-MNT-004",
    category: "manageability",
    severity: "warn",
    title: "Avoid setWorkflow(false)",
    why: "Skipping the engine hides writes from audit, notifications and other rules.",
    remediation: "Remove it, or document why every downstream rule must be skipped.",
    scripts: SERVER,
  },
  {
    id: "SN-MNT-005",
    category: "manageability",
    severity: "warn",
    title: "Script include name must match its class",
    why: "The platform resolves script includes by record name; a mismatched class is unreachable.",
    remediation: "Rename the class or the record so they match.",
    scripts: SERVER,
    classes: ["sys_script_include"],
  },
  {
    id: "SN-MNT-006",
    category: "manageability",
    severity: "info",
    title: "Describe new scripts",
    why: "A description explains intent to the next maintainer and to Instance Scan.",
    remediation: "Fill in the description field.",
    scripts: [],
  },
  {
    id: "SN-UX-001",
    category: "user_experience",
    severity: "warn",
    title: "Guard onChange scripts with isLoading",
    why: "onChange scripts also fire while the form loads, causing flicker and extra server calls.",
    remediation: "Start with: if (isLoading || newValue === '') { return; }",
    scripts: CLIENT,
    classes: CLIENT_SCRIPTS,
  },
  {
    id: "SN-UX-002",
    category: "user_experience",
    severity: "info",
    title: "Prefer UI policies for field state",
    why: "UI policies are declarative, ordered, reversible and faster to maintain.",
    remediation: "Replace the script with a UI policy and UI policy actions.",
    scripts: CLIENT,
    classes: CLIENT_SCRIPTS,
  },
  {
    id: "SN-UX-003",
    category: "user_experience",
    severity: "info",
    title: "No alert()/confirm() dialogs",
    why: "Browser dialogs block the page and do not work in Workspaces or mobile.",
    remediation: "Use g_form.addErrorMessage/showFieldMsg or GlideModal.",
    scripts: BROWSER,
  },
];

// The script kinds a class's scripts run as.
const CLASS_SCRIPTS: Readonly<Record<string, readonly ScriptKind[]>> = {
  sys_script: ["server"],
  sys_script_include: ["server"],
  sys_security_acl: ["server"],
  sys_ws_operation: ["server"],
  sysauto_script: ["server"],
  sysevent_script_action: ["server"],
  sys_script_fix: ["server"],
  sys_transform_map: ["server"],
  sys_script_client: ["client"],
  catalog_script_client: ["client"],
  sys_ui_policy: ["client"],
  sys_ui_action: ["server", "client"],
  sp_widget: ["server", "portal_client"],
};

// Rules that apply to records of these classes (all rules when no class is given).
export function rulesFor(classes: readonly string[]): Rule[] {
  if (classes.length === 0) {
    return [...RULES];
  }
  const kinds = new Set(classes.flatMap((c) => CLASS_SCRIPTS[c] ?? []));
  return RULES.filter((rule) =>
    rule.classes !== undefined
      ? rule.classes.some((c) => classes.includes(c))
      : rule.scripts.length === 0 || rule.scripts.some((kind) => kinds.has(kind)),
  );
}

export function ruleById(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}
