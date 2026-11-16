import { sha256Hex } from "../../kernel/sha256";
import type { ManagedAgentFiles } from "../ports";
import type { InstalledFile } from "./install-agent-pack";

// A generated header is not ownership: only a complete, known generated body may be removed.
export async function migrateWorkspaceSkills(
  files: ManagedAgentFiles,
  root: string,
  hashes: Readonly<Record<string, string>>,
  available: ReadonlySet<string>,
): Promise<InstalledFile[]> {
  const results: InstalledFile[] = [];
  for (const [path, expected] of Object.entries(hashes)) {
    if (!available.has(path)) continue;
    const existing = await files.read(`${root}/${path}`);
    if (existing === null) continue;
    const normalized = existing.replace(
      /^ {2}generated-by: snagentic [^\n]+$/m,
      "  generated-by: snagentic LEGACY",
    );
    if (sha256Hex(normalized) !== expected) results.push({ path, status: "skipped" });
    else {
      await files.remove(`${root}/${path}`);
      results.push({ path, status: "removed" });
    }
  }
  return results;
}
