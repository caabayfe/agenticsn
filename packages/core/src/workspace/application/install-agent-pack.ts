import { withAgentsImport, withInstructions } from "../domain/agent-pack";
import type { WorkspaceFiles } from "../ports";

export interface AgentPack {
  readonly version: string;
  // The always-loaded instructions, written as a block in AGENTS.md.
  readonly instructions: string;
  // Files owned by the pack (skills), relative to the workspace root.
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

export type InstallStatus = "created" | "updated" | "unchanged";

export interface InstalledFile {
  readonly path: string;
  readonly status: InstallStatus;
}

// Writes the pack into the workspace so the whole team gets it through git. Files whose
// content would not change are left untouched.
export async function installAgentPack(
  files: WorkspaceFiles,
  root: string,
  pack: AgentPack,
): Promise<InstalledFile[]> {
  const write = async (path: string, next: (existing: string | null) => string) => {
    const existing = await files.read(`${root}/${path}`);
    const content = next(existing);
    if (content === existing) {
      return { path, status: "unchanged" as const };
    }
    await files.write(`${root}/${path}`, content);
    return { path, status: existing === null ? ("created" as const) : ("updated" as const) };
  };
  const results: InstalledFile[] = [];
  for (const file of pack.files) {
    results.push(await write(file.path, () => file.content));
  }
  results.push(
    await write("AGENTS.md", (existing) =>
      withInstructions(existing, pack.instructions, pack.version),
    ),
  );
  results.push(await write("CLAUDE.md", withAgentsImport));
  return results;
}
