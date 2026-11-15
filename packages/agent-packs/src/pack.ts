import { COPILOT_HOOKS, COPILOT_HOOKS_PATH } from "./copilot-hooks";
import { instructions } from "./instructions";
import { renderBody, renderSkill, type Skill } from "./skill";
import { BUILD } from "./skills/build";
import { DELIVER } from "./skills/deliver";
import { DESIGN } from "./skills/design";
import { DOCUMENT } from "./skills/document";
import { EXPLAIN } from "./skills/explain";
import { REVIEW } from "./skills/review";
import { TEST } from "./skills/test";
import { TROUBLESHOOT } from "./skills/troubleshoot";

export const SKILLS: readonly Skill[] = [
  DESIGN,
  BUILD,
  REVIEW,
  EXPLAIN,
  DELIVER,
  DOCUMENT,
  TROUBLESHOOT,
  TEST,
].map((skill) => ({ ...skill, description: `In snagentic workspaces: ${skill.description}` }));

export const INSTRUCTIONS = instructions(SKILLS.map((skill) => skill.name));

// "copilot" also stands for the other hosts that read AGENTS.md and .agents/skills.
export type AgentHost = "claude" | "copilot" | "codex";

export interface PackFile {
  // Relative to the workspace root.
  readonly path: string;
  readonly content: string;
  // The hosts that read it; it is written when one of them is installed.
  readonly hosts: readonly AgentHost[];
}

// Where hosts look for skills: .agents/skills (the shared location: Codex, Copilot, Cursor) and
// .claude/skills (Claude Code, which does not read .agents/skills; checked with 2.1.285).
const SKILL_FOLDERS = [
  { folder: ".agents/skills", hosts: ["copilot", "codex"] },
  { folder: ".claude/skills", hosts: ["claude"] },
] as const;

// The files `agent install` writes, besides the instructions block in AGENTS.md and the
// hosts' settings.
export function skillFiles(version: string): PackFile[] {
  return SKILLS.flatMap((skill) => {
    const content = renderSkill(skill, version);
    return SKILL_FOLDERS.map(({ folder, hosts }) => ({
      path: `${folder}/${skill.name}/SKILL.md`,
      content,
      hosts,
    }));
  });
}

export function copilotHookFile(): PackFile {
  return {
    path: COPILOT_HOOKS_PATH,
    content: `${JSON.stringify(COPILOT_HOOKS, null, 2)}\n`,
    hosts: ["copilot"],
  };
}

export function referenceFiles(): PackFile[] {
  return SKILLS.flatMap((skill) =>
    (skill.references ?? []).flatMap((reference) =>
      SKILL_FOLDERS.map(({ folder, hosts }) => ({
        path: `${folder}/${skill.name}/references/${reference.name}.md`,
        content: reference.content,
        hosts,
      })),
    ),
  );
}

export interface PackPrompt {
  readonly mcpProfiles: readonly ("investigate" | "develop")[];
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
          mcpProfiles: skill.mcpProfiles ?? ["develop"],
          description: skill.prompt.description,
          message: (request: string) =>
            `Follow the ${skill.name} workflow for this request: ${request}\n\n${renderBody(skill)}${(skill.references ?? []).map((reference) => `\n${reference.content}`).join("")}`,
        },
      ],
);
