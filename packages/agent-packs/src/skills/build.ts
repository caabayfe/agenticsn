import type { Skill } from "../skill";

export const BUILD: Skill = {
  name: "servicenow-build",
  description:
    "Build an approved ServiceNow design as files in the workspace: create or edit records and scripts, then validate until clean. Use after servicenow-design, or when the user asks to implement a change they already agreed.",
  when: "A design the user approved. Without one, use servicenow-design first.",
  steps: [
    "`advise` with the same `intent` and `tables`, and `phase` build: follow its `guidance` and `rules` for the classes you touch.",
    "For each record to change, `describe` it (`target`: its path) and read the `files` it lists.",
    "Edit the YAML and script files. For a new record, follow an existing record of the same class (`find` with `class`).",
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
    "Never edit records outside the approved design, .snagentic/, or child-row files.",
  ],
};
