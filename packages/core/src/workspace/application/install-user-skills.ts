import { InvalidInputError } from "../../kernel/errors";
import { sha256Hex } from "../../kernel/sha256";
import type { ManagedAgentFiles } from "../ports";
import type { InstalledFile } from "./install-agent-pack";

const MANIFEST = ".snagentic/agent-pack/skills.json";
const SKILL_PATH =
  /^\.(?:agents|claude|copilot)\/skills\/servicenow-[a-z-]+\/(?:SKILL\.md|references\/[a-z-]+\.md)$/;
type Ownership = Record<string, readonly string[]>;

function ownership(text: string | null): Ownership {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (
        entries.every(
          ([path, hashes]) =>
            SKILL_PATH.test(path) &&
            Array.isArray(hashes) &&
            hashes.length > 0 &&
            hashes.length <= 2 &&
            hashes.every(
              (hash: unknown) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
            ),
        )
      ) {
        return Object.fromEntries(entries);
      }
    }
  } catch {
    /* An unreadable manifest cannot establish ownership. */
  }
  throw new InvalidInputError(
    "invalid user skill ownership manifest; restore .snagentic/agent-pack/skills.json before installing",
  );
}

export async function installUserSkills(
  files: ManagedAgentFiles,
  root: string,
  skills: readonly { readonly path: string; readonly content: string }[],
): Promise<InstalledFile[]> {
  for (const file of skills) {
    if (!SKILL_PATH.test(file.path))
      throw new InvalidInputError(`invalid skill path: ${file.path}`);
    await files.guard(root, `${root}/${file.path}`);
  }
  await files.guard(root, `${root}/${MANIFEST}`);
  const owned = ownership(await files.read(`${root}/${MANIFEST}`));
  const results: InstalledFile[] = [];
  for (const skill of skills) {
    const main = skill.path.replace(/\/references\/[^/]+$/, "/SKILL.md");
    if (main !== skill.path && !(await unchangedOwnedSkill(files, root, owned, main))) {
      results.push({ path: `${root}/${skill.path}`, status: "skipped" });
      continue;
    }
    results.push(await installSkill(files, root, owned, skill));
  }
  return results;
}

async function unchangedOwnedSkill(
  files: ManagedAgentFiles,
  root: string,
  owned: Ownership,
  path: string,
): Promise<boolean> {
  const content = await files.read(`${root}/${path}`);
  return content !== null && owned[path]?.includes(sha256Hex(content)) === true;
}

async function installSkill(
  files: ManagedAgentFiles,
  root: string,
  owned: Ownership,
  skill: { readonly path: string; readonly content: string },
): Promise<InstalledFile> {
  const path = `${root}/${skill.path}`;
  const existing = await files.read(path);
  const previous = existing === null ? null : sha256Hex(existing);
  const recognized = previous !== null && owned[skill.path]?.includes(previous) === true;
  if (existing !== null && !recognized) return { path, status: "skipped" };
  if (existing === skill.content) return { path, status: "unchanged" };
  // Journal both hashes before replacing a file: interrupted upgrades can safely resume.
  owned[skill.path] = [...(previous === null ? [] : [previous]), sha256Hex(skill.content)];
  await files.write(`${root}/${MANIFEST}`, `${JSON.stringify(owned, null, 2)}\n`);
  await files.write(path, skill.content);
  return { path, status: existing === null ? "created" : "updated" };
}
