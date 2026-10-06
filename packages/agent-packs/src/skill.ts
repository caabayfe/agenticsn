// A workflow skill (spec 003, section 5.1): a short procedure that routes the agent to the
// right tool at the right moment. ServiceNow knowledge lives in the engine, not here.
export interface Skill {
  readonly name: string;
  // The trigger: the situations it covers, in the user's words.
  readonly description: string;
  readonly when: string;
  readonly steps: readonly string[];
  readonly decide: readonly string[];
  readonly output: string;
  readonly stopAndAsk: string;
  readonly never: readonly string[];
  // The MCP prompt that starts this workflow, where the host offers prompts.
  readonly prompt?: { readonly name: string; readonly description: string };
}

const bullets = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n");

// The skill as an Agent Skills SKILL.md file.
export function renderSkill(skill: Skill, version: string): string {
  return [
    "---",
    `name: ${skill.name}`,
    // Quoted: descriptions hold ": " and quotes, which plain YAML scalars cannot.
    `description: ${JSON.stringify(skill.description)}`,
    "metadata:",
    `  generated-by: snagentic ${version}`,
    "---",
    "",
    renderBody(skill),
  ].join("\n");
}

// The procedure without its front matter: what an MCP prompt hands the agent.
export function renderBody(skill: Skill): string {
  return [
    "## When",
    skill.when,
    "",
    "## Steps",
    skill.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "",
    "## Decide",
    bullets(skill.decide),
    "",
    "## Output",
    skill.output,
    "",
    "## Stop and ask",
    skill.stopAndAsk,
    "",
    "## Never",
    bullets(skill.never),
    "",
  ].join("\n");
}
