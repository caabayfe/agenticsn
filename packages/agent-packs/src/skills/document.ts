import type { Skill } from "../skill";

export const DOCUMENT: Skill = {
  name: "servicenow-document",
  description:
    "Write or revise the documentation of a ServiceNow process (incident, request, change…) for its three readers: end users on the portal, operators on the workspace or form, and the platform team, capability by capability, verified against the instance's records. Use when asked to document a process, write a user or operator guide or training material, or update documentation after a change.",
  when: "Documentation of how people use the platform. To change behavior, use servicenow-design.",
  steps: [
    "Start from the readers, not the code; `describe` the table for its states and fields, and use `find` for every record below. Write documentation/processes/<process>/process.yaml: title, summary, roles (id, name, description, audience user or operator), lifecycle, understand topics, and capabilities in the order people meet them (id, title, summary, roles of one audience). Work both sides take part in is two capabilities, each the other's counterpart; the end user's may share the operator's configure page (configure: <id>).",
    "Understand pages (understand/<topic>.md: overview, lifecycle, priority and deadlines, who is told, glossary) are shared. Write the common text once; put what differs under headings marked {for=user} or {for=operator}.",
    "End users (use/<capability>.md): start at the portal named in site.yaml surfaces. Find the menus (sp_rectangle_menu_item), topics, the record producer and its questions (sc_cat_item_producer, item_option_new), the ticket page, Virtual Agent topics, email actions and the emails they get. Use the portal's words: no field, table or state names.",
    "Operators (operate/<capability>.md): start at the workspace list (sys_ux_list), then the form layout (sys_ui_section and its sys_ui_element children), actions (sys_declarative_action_assignment, sys_ui_action), policies, choices and notifications. Describe the workspace; note where the classic form differs.",
    "Platform team (configure/<topic>.md): the records behind each operator capability, in execution order, with scripts read for what they do. Every operator capability needs one.",
    "Every page carries evidence E01, E02, … (record <table>/<sys_id>, optional field or children, how, result) and cites claims as [E01]. A label the mirror can't prove: seen (by, on, where), checked on screen by a person. Label changes {label=NEW}, CORRECTED, RESTORED, CHANGED, DOCUMENTED-ONLY or OPEN-QUESTION; add {{animation:<name>}} for what moves.",
    "Run `snagentic docs pin`, then `snagentic docs check` until it has no errors and you have read every warning, then `snagentic docs build`; `snagentic docs serve` to preview.",
  ],
  decide: [
    "A role exists in the code but you cannot tell what it does for people: ask, or mark OPEN-QUESTION.",
    "`snagentic docs check` lists changed evidence, or `validate` reports SN-MNT-014 or SN-MNT-015: re-read the record, fix every page that cites it in the same change, then pin.",
    "A platform-words warning on an end user's page: rewrite in the portal's words, or move the sentence under {for=operator}.",
  ],
  output:
    "The process, its pages per section, the `snagentic docs check` result, and the open questions for the process owner.",
  stopAndAsk:
    "If the readers or their surfaces are not clear (several portals, workspace or classic form), ask the process owner before writing guides.",
  never: [
    "Never write a guide as a list of configuration; that belongs on the configure page.",
    "Never pin evidence you did not re-read after a change, and never write seen evidence for a screen nobody looked at.",
    "Never put business records, customer names or values the mirror redacted on a page, and never publish the site yourself.",
  ],
  prompt: {
    name: "document",
    description: "Document a process for its users, from the instance's records",
  },
};
