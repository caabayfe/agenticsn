import { instanceConfirmsRows } from "@snagentic/core";
import { fromYamlStrings } from "../yaml/own-style";
import { runGit, runGitOrThrow } from "./run-git";

const CHILD_FILE = /\.children\.[^/]+\.yaml$/;

const lines = (text: string) => text.split("\n").filter(Boolean);

async function rowsAt(root: string, rev: string, path: string): Promise<unknown | null> {
  const shown = await runGit(["show", `${rev}:${path}`], root);
  return shown.exitCode === 0 ? fromYamlStrings(shown.stdout) : null;
}

// Child-row files changed here and on the instance (ADR-0025): when the instance's rows confirm
// the local ones, take the instance's file, which adds only the platform's provenance.
export async function takeConfirmedRows(
  root: string,
  branch: string,
  conflicted: readonly string[],
): Promise<string[]> {
  const confirmed: string[] = [];
  for (const path of conflicted.filter((candidate) => CHILD_FILE.test(candidate))) {
    if (instanceConfirmsRows(await rowsAt(root, "HEAD", path), await rowsAt(root, branch, path))) {
      await runGitOrThrow(["checkout", "--theirs", "--", path], root);
      await runGitOrThrow(["add", "--", path], root);
      confirmed.push(path);
    }
  }
  return confirmed;
}

// Whether each child-row file of a record created here is confirmed by the same file of the
// record as pulled back under another name: only then may the local files go.
export async function childFilesConfirmed(
  root: string,
  where: { readonly mine: string; readonly theirs: string; readonly branch: string },
): Promise<boolean> {
  const { mine, theirs, branch } = where;
  const folder = mine.slice(0, mine.lastIndexOf("/"));
  const listed = lines(await runGitOrThrow(["ls-tree", "--name-only", "HEAD", `${folder}/`], root));
  for (const path of listed.filter((name) => name.startsWith(`${mine}.children.`))) {
    const remote = `${theirs}${path.slice(mine.length)}`;
    if (
      !instanceConfirmsRows(await rowsAt(root, "HEAD", path), await rowsAt(root, branch, remote))
    ) {
      return false;
    }
  }
  return true;
}
