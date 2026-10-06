// The agent pack's footprint in files the team also edits (spec 003, section 5.4). Only the
// marked block is ours: everything around it is the team's and is kept as it is.

const BEGIN = /<!-- snagentic:begin ([^ ]+) -->/;
const END = "<!-- snagentic:end -->";

const block = (instructions: string, version: string) =>
  `<!-- snagentic:begin ${version} -->\n${instructions}\n${END}`;

// AGENTS.md with the instructions block written or replaced.
export function withInstructions(
  existing: string | null,
  instructions: string,
  version: string,
): string {
  const fresh = block(instructions, version);
  if (existing === null || existing.trim() === "") {
    return `${fresh}\n`;
  }
  const begin = BEGIN.exec(existing);
  const end = existing.indexOf(END);
  if (begin !== null && end > begin.index) {
    return existing.slice(0, begin.index) + fresh + existing.slice(end + END.length);
  }
  return `${existing.trimEnd()}\n\n${fresh}\n`;
}

// The pack version AGENTS.md's block was written by, or null when it has none.
export function installedPackVersion(agentsMd: string | null): string | null {
  return agentsMd === null ? null : (BEGIN.exec(agentsMd)?.[1] ?? null);
}

// CLAUDE.md importing AGENTS.md: Claude Code reads CLAUDE.md, every other host AGENTS.md.
export function withAgentsImport(existing: string | null): string {
  if (existing === null) {
    return "@AGENTS.md\n";
  }
  return existing.split("\n").some((line) => line.trim() === "@AGENTS.md")
    ? existing
    : `${existing.trimEnd()}\n\n@AGENTS.md\n`;
}
