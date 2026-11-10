import { checkMirrorScope, InstanceName, type MirrorTreeEntry } from "@snagentic/core";
import { runGitOrThrow } from "./run-git";

// `git ls-tree -r -z`: "<mode> <type> <object>\t<path>" per entry.
function treeEntries(output: string): MirrorTreeEntry[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      return { path: entry.slice(tab + 1), mode: entry.split(" ")[0] ?? "" };
    });
}

// `git diff-tree -r -z --raw`: ":<old mode> <new mode> <old> <new> <status>", then the path.
function changedEntries(output: string): MirrorTreeEntry[] {
  const fields = output.split("\0");
  const entries: MirrorTreeEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const header = fields[i] ?? "";
    const path = fields[i + 1] ?? "";
    if (header === "") break;
    entries.push({ path, mode: header.split(" ")[1] ?? "" });
  }
  return entries;
}

// What taking `to` brings in, checked against the folders a pull writes: every path changed since
// `from`, or the whole tree when there is no `from`. Throws MirrorScopeError when anything else
// would come in.
export async function checkMirrorCommits(
  root: string,
  instance: string,
  range: { readonly from: string | null; readonly to: string },
): Promise<void> {
  const name = InstanceName.parse(instance);
  const entries =
    range.from === null
      ? treeEntries(await runGitOrThrow(["ls-tree", "-r", "-z", "--full-tree", range.to], root))
      : changedEntries(
          await runGitOrThrow(
            [
              "diff-tree",
              "-r",
              "-z",
              "--raw",
              "--no-renames",
              "--no-commit-id",
              range.from,
              range.to,
            ],
            root,
          ),
        );
  checkMirrorScope(name, entries);
}
