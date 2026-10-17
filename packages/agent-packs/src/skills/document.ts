import type { Skill } from "../skill";

export const DOCUMENT: Skill = {
  name: "servicenow-document",
  description:
    "Write or revise the user guide of a ServiceNow process (incident, request, change…) for the people who use it, capability by capability, verified against the instance's records, with a technical page behind each capability. Use when asked to document a process, write a user guide or training material, or update documentation after a change.",
  when: "Documentation of how people use the platform. To change behavior, use servicenow-design.",
  steps: [
    "Start from the consumer, not the code. Name the process's roles (who reports, who works, who approves, who watches) and its lifecycle from the table's state choices (`describe` the table).",
    "Find what each role touches with `find`: modules (sys_app_module), form sections (sys_ui_section), buttons (sys_ui_action), mandatory and hidden fields (sys_ui_policy, sys_script_client), notifications (sysevent_email_action), SLAs (contract_sla), portal pages and catalog items. Rules and scripts explain what happens after they act.",
    "Write documentation/processes/<process>/process.yaml: title, summary in plain words, roles (id, name, description), lifecycle (state, meaning), capabilities in the order people meet them (id, title, summary, roles).",
    "Write overview.guide.md (what the process is for, when to use it, words people need) and, per capability, <capability>.guide.md for its roles: before you start, step by step (where to click, what to fill, which button), what happens next (state, who is told, SLA), if something goes wrong, tips. Plain words, second person, no table or script names.",
    "Write <capability>.technical.md for the platform owner: the records behind each step, in execution order. Both pages carry evidence E01, E02, … (record <table>/<sys_id>, optional field, how, result) and cite claims as [E01].",
    "Label sections that differ from earlier documentation {label=NEW}, CORRECTED, RESTORED, CHANGED, DOCUMENTED-ONLY or OPEN-QUESTION. For a lifecycle or decision, add an animation (documentation/animations/<name>/) and {{animation:<name>}} on its own line.",
    "Run `snagentic docs pin`, then `snagentic docs check` until it passes, then `snagentic docs build`; `snagentic docs serve` to preview.",
  ],
  decide: [
    "A role exists in the code but you cannot tell what it does for people: ask, or mark OPEN-QUESTION.",
    "`snagentic docs check` lists changed evidence: re-read the record, fix the guide and the technical page, then pin.",
    "Behavior that depends on data you cannot see (assignment data, schedules, user roles): say what decides it, label DOCUMENTED-ONLY.",
  ],
  output:
    "The process, its capabilities and pages, the `snagentic docs check` result, and the open questions for the process owner.",
  stopAndAsk:
    "If the process's roles or scope are not clear from the instance (customised states, several portals), ask the process owner before writing guides.",
  never: [
    "Never write the user guide as a list of configuration; that belongs on the technical page.",
    "Never pin evidence you did not re-read after a change.",
    "Never put business records, customer names or values the mirror redacted on a page, and never publish the site yourself.",
  ],
  prompt: {
    name: "document",
    description: "Document a process for its users, from the instance's records",
  },
};
