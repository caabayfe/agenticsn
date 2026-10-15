import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeReplaced } from "../../../src/adapters/git/replaced-records";
import { runGit, runGitOrThrow } from "../../../src/adapters/git/run-git";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const META = "instances/pdi/metadata";
const BRANCH = "servicenow-remote/pdi";
const FOLDER = `${META}/global/sys_ui_related_list`;
const [OLD, NEW] = ["a".repeat(32), "b".repeat(32)];
const file = (id: string) => `${FOLDER}/task-default-view--${id}`;

const record = (id: string) =>
  `_meta:\n  sys_class_name: sys_ui_related_list\n  sys_id: ${id}\n  sys_domain: global\nname: task\nview: Default view\nsys_user: ''\n`;
const entries = (id: string, lists: string[]) =>
  lists
    .map(
      (list, i) =>
        `- sys_id: ${id.slice(0, 31)}${i}\n  list_id: ${id}\n  related_list: ${list}\n  position: '${i}'\n  filter: ''\n  order_by: ''\n  group_by_field: ''\n`,
    )
    .join("");

const git = (root: string, ...args: string[]) => runGitOrThrow(args, root);

async function put(root: string, id: string, lists: string[]) {
  await mkdir(join(root, FOLDER), { recursive: true });
  await writeFile(join(root, `${file(id)}.yaml`), record(id));
  await writeFile(
    join(root, `${file(id)}.children.sys_ui_related_list_entry.yaml`),
    entries(id, lists),
  );
}

// main edited the related list to `local`; the instance replaced it with `instance` entries.
async function merging(local: string[], instance: string[]) {
  const root = await mkdtemp(join(tmpdir(), "replaced-"));
  temporary.push(root);
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.name", "t");
  await git(root, "config", "user.email", "t@t");
  await put(root, OLD, ["task.parent"]);
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "pull");
  await git(root, "branch", BRANCH);
  await put(root, OLD, local);
  await git(root, "commit", "-qam", "edit");
  await git(root, "checkout", "-q", BRANCH);
  await git(
    root,
    "rm",
    "-q",
    `${file(OLD)}.yaml`,
    `${file(OLD)}.children.sys_ui_related_list_entry.yaml`,
  );
  await put(root, NEW, instance);
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "pull: replaced");
  await git(root, "checkout", "-q", "main");
  await runGit(["merge", "--no-commit", BRANCH], root);
  const unmerged = (await git(root, "diff", "--name-only", "--diff-filter=U"))
    .split("\n")
    .filter(Boolean);
  return { root, unmerged };
}

describe("integrate: related lists the instance replaced (ADR-0030)", () => {
  it("takes the replacement when it holds what was pushed, and drops the local file", async () => {
    const pushed = ["task.parent", "sys_email.instance"];
    const { root, unmerged } = await merging(pushed, pushed);
    expect(unmerged).toEqual([`${file(OLD)}.children.sys_ui_related_list_entry.yaml`]);
    expect(await takeReplaced(root, { metadata: META, branch: BRANCH }, unmerged)).toEqual([
      `${file(NEW)}.yaml`,
    ]);
    expect(await git(root, "diff", "--name-only", "--diff-filter=U")).toBe("");
    expect(await git(root, "ls-files", FOLDER)).not.toContain(OLD);
  });

  it("leaves the conflict when the replacement holds something else", async () => {
    // Someone changed it again on the instance: entries other than the ones pushed.
    const { root, unmerged } = await merging(
      ["task.parent", "sys_email.instance"],
      ["sys_journal_field.element_id", "sys_attachment.table_sys_id", "problem.parent"],
    );
    expect(await takeReplaced(root, { metadata: META, branch: BRANCH }, unmerged)).toEqual([]);
    expect(await git(root, "diff", "--name-only", "--diff-filter=U")).toContain(OLD);
  });

  it("does nothing without a conflicting related lists file", async () => {
    expect(await takeReplaced("/nowhere", { metadata: META, branch: BRANCH }, ["x.yaml"])).toEqual(
      [],
    );
  });
});
