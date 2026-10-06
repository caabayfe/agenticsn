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

const HOOK_MARK = "# snagentic: validate before every commit";

// The pre-commit hook (ADR-0011, layer 4): validate, so a commit with block findings fails.
// It skips quietly where snagentic is not installed, so the repository stays usable.
export const PRE_COMMIT_HOOK = [
  "#!/bin/sh",
  `${HOOK_MARK} (ADR-0011). Installed by snagentic agent install.`,
  "command -v snagentic >/dev/null 2>&1 || exit 0",
  "exec snagentic validate --format agent",
  "",
].join("\n");

// Ours to write when there is no hook, or it is ours; null when the team has its own hook.
export function withPreCommitHook(existing: string | null): string | null {
  return existing === null || existing.includes(HOOK_MARK) ? PRE_COMMIT_HOOK : null;
}
