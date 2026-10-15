import { identityFolder, replacementConfirms } from "@snagentic/core";
import { fromYamlStrings } from "../yaml/own-style";
import { runGit, runGitOrThrow } from "./run-git";

// A form's related lists record edited here and pushed comes back under a new sys_id: the platform
// replaces it on every save, and pull removes the old file (ADR-0030). git sees the local edit and
// the instance's removal as a modify/delete conflict. When the instance's replacement confirms the
// local record, the local file goes and the replacement stays; otherwise both are left to the user.

const RELATED = /\/sys_ui_related_list\/[^/]+\.yaml$/;
const ROWS = ".children.sys_ui_related_list_entry.yaml";

const lines = (text: string) => text.split("\n").filter((line) => line !== "");

// <identity folder>/<file name without sys_id>, relative to the metadata root.
function nameKey(metadata: string, path: string) {
  const relative = path.slice(metadata.length + 1).replace(/\.yaml$/, "");
  const slash = relative.lastIndexOf("/");
  const leaf = relative.slice(slash + 1).replace(/--[0-9a-f]{32}$/, "");
  return `${identityFolder(relative.slice(0, slash))}/${leaf}`;
}

async function document(root: string, rev: string, path: string): Promise<unknown> {
  const shown = await runGit(["show", `${rev}:${path}`], root);
  return shown.exitCode === 0 ? fromYamlStrings(shown.stdout) : null;
}

const copyAt = async (root: string, rev: string, path: string) => ({
  document: await document(root, rev, path),
  rows: await document(root, rev, path.replace(/\.yaml$/, ROWS)),
});

export async function takeReplaced(
  root: string,
  where: { readonly metadata: string; readonly branch: string },
  unmerged: readonly string[],
): Promise<string[]> {
  // The record file, or its entries file when only the entries were edited.
  const edited = [
    ...new Set(
      unmerged
        .map((path) => (path.endsWith(ROWS) ? `${path.slice(0, -ROWS.length)}.yaml` : path))
        .filter((path) => RELATED.test(path) && !path.includes(".children.")),
    ),
  ];
  if (edited.length === 0) return [];
  const fork = (await runGitOrThrow(["merge-base", "HEAD", where.branch], root)).trim();
  const added = lines(
    await runGitOrThrow(
      [
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=A",
        fork,
        where.branch,
        "--",
        where.metadata,
      ],
      root,
    ),
  ).filter((path) => RELATED.test(path) && !path.includes(".children."));
  const confirmed: string[] = [];
  for (const path of edited) {
    const removed = (await runGit(["cat-file", "-e", `${where.branch}:${path}`], root)).exitCode;
    if (removed === 0) continue;
    const mine = await copyAt(root, "HEAD", path);
    for (const replacement of added.filter(
      (other) => nameKey(where.metadata, other) === nameKey(where.metadata, path),
    )) {
      if (replacementConfirms(mine, await copyAt(root, where.branch, replacement))) {
        const own = [path, path.replace(/\.yaml$/, ROWS)];
        await runGitOrThrow(["rm", "-q", "--ignore-unmatch", "--", ...own], root);
        confirmed.push(replacement);
        break;
      }
    }
  }
  return confirmed;
}
