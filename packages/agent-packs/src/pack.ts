import { instructions } from "./instructions";
import { renderBody, renderSkill, type Skill } from "./skill";
import { BUILD } from "./skills/build";
import { DESIGN } from "./skills/design";
import { EXPLAIN } from "./skills/explain";
import { REVIEW } from "./skills/review";

// servicenow-deliver joins when plan_push and push exist (spec 003, step 5).
export const SKILLS: readonly Skill[] = [DESIGN, BUILD, REVIEW, EXPLAIN];

export const INSTRUCTIONS = instructions(SKILLS.map((skill) => skill.name));

export interface PackFile {
  // Relative to the workspace root.
  readonly path: string;
  readonly content: string;
}

// Where hosts look for skills: .agents/skills (the shared location: Codex, Copilot, Cursor) and
// .claude/skills (Claude Code, which does not read .agents/skills; checked with 2.1.285).
const SKILL_FOLDERS = [".agents/skills", ".claude/skills"];

// The files `agent install` writes, besides the instructions block in AGENTS.md.
export function skillFiles(version: string): PackFile[] {
  return SKILLS.flatMap((skill) => {
    const content = renderSkill(skill, version);
    return SKILL_FOLDERS.map((folder) => ({ path: `${folder}/${skill.name}/SKILL.md`, content }));
  });
}

export interface PackPrompt {
  readonly name: string;
  readonly description: string;
  // The message that starts the workflow for the user's request.
  readonly message: (request: string) => string;
}

export const PROMPTS: readonly PackPrompt[] = SKILLS.flatMap((skill) =>
  skill.prompt === undefined
    ? []
    : [
        {
          name: skill.prompt.name,
          description: skill.prompt.description,
          message: (request: string) =>
            `Follow the ${skill.name} workflow for this request: ${request}\n\n${renderBody(skill)}`,
        },
      ],
);
