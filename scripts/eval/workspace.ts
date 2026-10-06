import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withInstructions } from "../../packages/core/src/index";
import type { Variant, WorkspaceChanges } from "./types";

// Where a slot's instances point: an address that can never resolve, so nothing an agent does
// during an evaluation reaches a real instance (and no keychain entry matches it).
const UNREACHABLE = "https://eval.invalid";

async function run(command: readonly string[], cwd: string, env: Record<string, string> = {}) {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

async function git(slot: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, code } = await run(
    ["git", "-c", "user.name=eval", "-c", "user.email=eval@snagentic", ...args],
    slot,
  );
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")}: ${stderr}`);
  }
  return stdout.trim();
}

// A reusable copy of the source workspace (an APFS clone: fast, and no extra disk until
// written), with its instances made unreachable. Recreated when the source moves on.
export async function ensureSlot(source: string, slot: string): Promise<void> {
  const sourceHead = (await run(["git", "rev-parse", "HEAD"], source)).stdout.trim();
  const marker = join(slot, ".git", "eval-source");
  if (existsSync(marker) && (await readFile(marker, "utf8")) === sourceHead) {
    return;
  }
  await rm(slot, { recursive: true, force: true });
  await mkdir(dirname(slot), { recursive: true });
  const copy = await run(["cp", "-c", "-R", source, slot], "/");
  if (!existsSync(join(slot, ".git"))) {
    throw new Error(`could not copy ${source}: ${copy.stderr}`);
  }
  for (const name of await readdir(join(slot, "instances"))) {
    const profile = join(slot, "instances", name, "instance.yaml");
    const text = await readFile(profile, "utf8");
    await writeFile(profile, text.replace(/^url: .*$/m, `url: ${UNREACHABLE}`));
  }
  await git(slot, "add", "-A", "--", "instances", "snagentic.yaml", ".gitignore");
  await git(slot, "commit", "-q", "--no-verify", "-m", "eval: unreachable instances");
  await git(slot, "tag", "-f", "eval-root");
  await writeFile(marker, sourceHead);
}

// Prepares the slot for a variant (pack installed, instructions replaced, skills removed or
// not) and returns the commit every run of that variant starts from.
export async function prepareVariant(
  slot: string,
  variant: Variant,
  binary: string,
): Promise<string> {
  await git(slot, "reset", "-q", "--hard", "eval-root");
  await git(slot, "clean", "-q", "-fd");
  const install = await run([binary, "agent", "install"], slot, { SNAGENTIC_WORKSPACE: slot });
  if (install.code !== 0) {
    throw new Error(`agent install: ${install.stderr}`);
  }
  if (variant.instructions !== undefined) {
    const agents = join(slot, "AGENTS.md");
    const version = (/snagentic:begin ([^ ]+)/.exec(await readFile(agents, "utf8")) ?? [])[1] ?? "";
    await writeFile(agents, withInstructions(null, variant.instructions, version));
  }
  if (!variant.skills) {
    await rm(join(slot, ".agents"), { recursive: true, force: true });
    await rm(join(slot, ".claude"), { recursive: true, force: true });
  }
  await git(slot, "add", "-A");
  await git(
    slot,
    "commit",
    "-q",
    "--no-verify",
    "--allow-empty",
    "-m",
    `eval: variant ${variant.id}`,
  );
  return git(slot, "rev-parse", "HEAD");
}

export async function resetTo(slot: string, base: string): Promise<void> {
  await git(slot, "reset", "-q", "--hard", base);
  await git(slot, "clean", "-q", "-fd");
}

// What the run left behind, against its base: edits, commits the agent made, new files.
export async function changesSince(
  slot: string,
  base: string,
  binary: string,
): Promise<WorkspaceChanges> {
  const edited = await git(slot, "diff", "--name-only", "--no-renames", base);
  const added = await git(slot, "ls-files", "--others", "--exclude-standard");
  const changed = [...new Set([...edited.split("\n"), ...added.split("\n")])]
    .filter(Boolean)
    .sort();
  const check = await run([binary, "validate", "--base", base, "--format", "json"], slot, {
    SNAGENTIC_WORKSPACE: slot,
  });
  let validatePassed: boolean | null = null;
  try {
    validatePassed = JSON.parse(check.stdout).passed === true;
  } catch {
    validatePassed = null;
  }
  return { changed, validatePassed };
}

export { run };
