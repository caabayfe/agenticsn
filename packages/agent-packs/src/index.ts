// Public API of @snagentic/agent-packs: the workflow skills, instructions and prompts,
// written once and rendered for every host (spec 003, section 5.4).

export { CLAUDE_SETTINGS } from "./claude-settings";
export { INSTRUCTIONS, type PackFile, type PackPrompt, PROMPTS, SKILLS, skillFiles } from "./pack";
export { renderBody, renderSkill, type Skill } from "./skill";
