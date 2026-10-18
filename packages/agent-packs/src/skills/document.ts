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
    "The employee guide (ADR-0037): employees enter by what they want to do, not by process. Write a getting-help process first (use/channels.md: every way to reach IT that is proven enabled, by a record or a screen, each with when to use it, how, and what comes back; use/employee-center.md: the portal's menu, search, topics, My Requests, My Tasks, notifications), then the employees: block in site.yaml (title, intro, start pages, task groups of <process>/<topic>). Each use/ page follows one frame: what it is for, before you start, numbered steps that say what you do and what you then see, what happens next, the emails and messages quoted exactly, tips, and an I want to… table of links. Explain how to use the catalog (search, topics, bundles, the item page, required questions) without a page per item. Employees see no citations, labels, evidence or open questions: anything uncertain goes in a section whose heading is labelled OPEN-QUESTION, worded for the platform team (the IT guide lists them all), never in employee text; link related pages with see: links, never plain italics; choose the processes explained to employees with employees.how in site.yaml.",
    "Operators (operate/<capability>.md): start at the workspace list (sys_ux_list), then the form layout (sys_ui_section and its sys_ui_element children), actions (sys_declarative_action_assignment, sys_ui_action), policies, choices and notifications. Describe the workspace; note where the classic form differs.",
    "Platform team (configure/<topic>.md): the records behind each operator capability, in execution order, with scripts read for what they do. Every operator capability needs one.",
    "The mirror: choice labels are children of the table's sys_db_object record; on-screen labels (sys_documentation) aren't mirrored; property values are, unless private. Link other pages as [text](see:<process>/<topic>); the check fails on a dead link.",
    "Every page carries evidence E01, E02, … (record <table>/<sys_id>, optional field or children, how, result) and cites claims as [E01]. A label the mirror can't prove: seen (by, on, where), checked on screen by a person. Label changes {label=NEW}, CORRECTED, RESTORED, CHANGED, DOCUMENTED-ONLY or OPEN-QUESTION; add {{animation:<name>}} for what moves.",
    "Every use/ and operate/ page shows its capability as a narrated animation (documentation/animations/<name>/: animation.json, scene.svg, steps.json with t, c and say per step) embedded with {{animation:<name>}}; add one to understand/ pages that explain a flow. docs check fails without it. Build with --video and look at the frames.",
    "Before publishing, list what only a screen can prove (portal content the mirror lacks, labels, actions that are configured but may not show) and have a person check it, ideally as an end user, recorded as seen evidence.",
    "Run `snagentic docs pin`, then `snagentic docs check` until it has no errors and you have read every warning, then `snagentic docs build`; `snagentic docs serve` to preview.",
  ],
  decide: [
    "A role exists in the code but you cannot tell what it does for people: ask, or mark OPEN-QUESTION.",
    "`snagentic docs check` lists changed evidence, or `validate` reports SN-MNT-014 or SN-MNT-015: run `snagentic docs impact` against the branch the change merges into (--base origin/main), as JSON (--format json), re-read each record, fix every claim it lists in the same change, then pin. Put the text output in the pull request description so reviewers see what readers are told differently.",
    "A fix changes what employees or IT do, or `validate` reports SN-MNT-017: add a note to the release file, documentation/changes/<release>.md (title, date, notes with for: employees or it, note in the readers' words, see: the pages), creating the file for a new release. The What's new pages list the notes.",
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
