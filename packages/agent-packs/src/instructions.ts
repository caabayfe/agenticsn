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
    "- Never call the instance's API yourself (REST, background scripts): only through snagentic.",
    "- Never edit .snagentic/, the servicenow-remote branches, or child-row files by hand.",
    "- When a result says `stale`, offer `pull` before relying on the mirror.",
    "",
    `Skills: ${skills.join(", ")}.`,
  ].join("\n");
}
