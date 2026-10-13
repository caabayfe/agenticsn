import type { Skill } from "../skill";

export const BUILD: Skill = {
  name: "servicenow-build",
  description:
    "Build an approved ServiceNow design as files in the workspace: create or edit records and scripts, then validate until clean. Use after servicenow-design, or when the user asks to implement a change they already agreed.",
  when: "A design the user approved. Without one, use servicenow-design first.",
  steps: [
    "`advise` with the same `intent` and `tables`, and `phase` build: follow its `guidance` and `rules` for the classes you touch.",
    "For each record to change, `describe` it (`target`: its path) and read the `files` it lists.",
    "Edit the YAML and script files. For a new record, follow an existing record of the same class (`find` with `class`): a new 32-character hex sys_id, and the file named after its name in lowercase with dashes, then --<sys_id>.yaml.",
    "A new application (when the design asks for a new scope): add <scope>/sys_app/<name>--<sys_id>.yaml with name, scope and version 1.0.0; the scope is x_ then the instance's company code (the value of the property glide.appcreator.company.code in the mirror) then _ and a short name. Its sys_id is the scope's: every record of the application sits in the <scope> folder with that scope in _meta.",
    "On a domain-separated instance (status lists its domains), a record's domain is _meta.sys_domain: leave it out for an application's logic, which belongs in global, and set it to a customer's domain only for that customer's own changes. Push writes it, and changing it moves the record.",
    "For choices and form or list layouts, add rows to the owner's child-row file (create it if missing): a new 32-character hex sys_id, the parent field naming the owner (for a choice, name holds the table; for layouts, sys_ui_section, list_id or sys_ui_form holds the owner's sys_id), and only content fields. Copy an existing row of the same table (`find` with `class`) for the fields to set.",
    "`validate` (no arguments: everything changed since the last commit).",
    "Fix every finding whose `severity` is block, and each warn unless the user accepts it. Repeat `validate` until it has `passed`.",
  ],
  decide: [
    "A finding is on a line you did not mean to change: `validate` reports only what the change introduced, so check your edit.",
    "`notChecked` is not empty: tell the user which files were not checked and why.",
    "A fix would change the approved design: stop and go back to the user.",
  ],
  output:
    "The files changed (paths), the final `counts` from `validate`, and any warn the user accepted, with its `ruleId`.",
  stopAndAsk:
    "When a fix would change the approved design, or a finding looks wrong (say which `ruleId` and why).",
  never: [
    "Never silence or work around a finding to make `validate` pass.",
    "Never edit records outside the approved design or .snagentic/; never edit flow, workflow or variable-value child rows; never remove a row from a child-row file (set a choice inactive instead).",
  ],
};
