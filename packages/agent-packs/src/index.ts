// Public API of @snagentic/agent-packs: the workflow skills, instructions and prompts,
// written once and rendered for every host (spec 003, section 5.4).

export { CLAUDE_SETTINGS, SHELL_DENY } from "./claude-settings";
export { COPILOT_HOOKS, COPILOT_HOOKS_PATH } from "./copilot-hooks";
export { MCP_CONFIGS } from "./mcp-configs";
export {
  type AgentHost,
  copilotHookFile,
  INSTRUCTIONS,
  type PackFile,
  type PackPrompt,
  PROMPTS,
  SKILLS,
  skillFiles,
} from "./pack";
export { renderBody, renderSkill, type Skill } from "./skill";
