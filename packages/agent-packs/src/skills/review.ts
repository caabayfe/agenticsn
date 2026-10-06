import type { Skill } from "../skill";

export const REVIEW: Skill = {
  name: "servicenow-review",
  description:
    'Review ServiceNow changes: "review", "check my changes", "is this ready", a pull request or a branch, before delivery. Reports each finding with its rule id and path and proposes fixes.',
  when: "Reviewing local edits, a branch or a pull request. While building, servicenow-build validates as it goes.",
  steps: [
    "`validate`: no arguments for local edits; `base` set to the target branch (for example origin/main) for a branch or pull request; `paths` for specific files.",
    "For each finding, in order: read the file at its `path` and `line`, and explain it with its `ruleId`, `why` and `remediation`, for this code.",
    "When a finding needs context (who calls this script, what else runs on the table), `describe` the record or the table.",
    "Propose a fix for each finding as a diff, without applying it.",
    "Report `notChecked` and `rulesNotChecked`, so the user knows what the review did not cover.",
  ],
  decide: [
    "`passed` is false: the change must not be delivered until its block findings are fixed.",
    "`records` is 0: nothing changed against `base`; confirm the base with the user.",
  ],
  output:
    "One line with the `counts`, then one entry per finding: severity, `ruleId`, path and line, what is wrong here, and the fix. Then what was not checked.",
  stopAndAsk:
    "Before applying any fix. When a finding looks like a false positive, say so with its `ruleId` instead of dismissing it.",
  never: [
    "Never rewrite code silently: every change is proposed with its rule id.",
    "Never dismiss a block finding.",
  ],
  prompt: { name: "review", description: "Review ServiceNow changes and explain each finding" },
};
