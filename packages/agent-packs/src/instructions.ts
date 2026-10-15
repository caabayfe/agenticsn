// Always in context (spec 003, section 4): written to the workspace's AGENTS.md and served as
// the MCP server's instructions. Kept short; everything else is reached through a skill or a
// tool result's `next`.
export function instructions(skills: readonly string[]): string {
  return [
    "# ServiceNow workspace (snagentic)",
    "",
    "This repository mirrors ServiceNow instances: instances/<name>/metadata holds every",
    "record as YAML, with its scripts as files beside it. Use snagentic's MCP tools (or the",
    "`snagentic` CLI) for everything about the instance.",
    "",
    "Golden rules",
    "- Understand before changing: `describe` the tables and records involved, `advise` on",
    "  the intent, and agree the design with the user before editing.",
    "- Prefer configuration over code; never edit an out-of-box record you can extend.",
    "- After editing, `validate` until it has `passed`; never skip or silence a finding.",
    "- Deliver only with `plan_push` and `push`, after the user approves the plan; never call the",
    "  instance's API yourself (REST, background scripts).",
    "- Never edit .snagentic/ or the servicenow-remote branches by hand. Child records with",
    "  their own folder, such as UI policy actions, are records: create and edit them like any",
    "  other. Child-row files (<record>.children.<table>.yaml) are read-only, except a table's",
    "  choices (sys_choice, beside its sys_db_object record; never remove one) and the rows of",
    "  layouts (lists, forms, form sections, related lists): a layout is pushed whole, so add,",
    "  change, reorder or remove its rows.",
    "- A new feature belongs in its own scoped application; on a domain-separated instance its",
    "  logic belongs in global (see the build skill).",
    "- When a result says `stale`, offer `pull` before relying on the mirror.",
    "",
    `Skills: ${skills.join(", ")}.`,
  ].join("\n");
}
