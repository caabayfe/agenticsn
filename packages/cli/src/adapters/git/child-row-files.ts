import { gitLines } from "./run-git";

// Child-row files in our YAML style (ADR-0015) are sequences of flat maps: each row starts with
// "- " at the start of a line, and its keys are indented by exactly two spaces. Multi-line
// values are block scalars indented further, so neither pattern matches inside them.

const suffixOf = (table: string) => `.children.${table}.yaml`;

// Splits git grep's "<tip>:<path>:<match>" lines.
function parse(line: string, tip: string): { path: string; match: string } {
  const rest = line.slice(tip.length + 1);
  const end = rest.indexOf(":");
  return { path: rest.slice(0, end), match: rest.slice(end + 1) };
}

// Record base (relative to `root`) -> rows in its child-row file for `table`.
export async function countChildRows(
  repository: string,
  tip: string,
  root: string,
  table: string,
): Promise<Map<string, number>> {
  const suffix = suffixOf(table);
  const counts = new Map<string, number>();
  const args = ["grep", "-c", "-e", "^- ", tip, "--", `${root}/*${suffix}`];
  for await (const line of gitLines(args, repository, [0, 1])) {
    const { path, match } = parse(line, tip);
    counts.set(path.slice(root.length + 1, -suffix.length), Number(match));
  }
  return counts;
}

// Child-row sys_id -> base (relative to `root`) of the record whose files hold that row.
export async function childRowOwners(
  repository: string,
  tip: string,
  root: string,
  tables: readonly string[],
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  if (tables.length === 0) {
    return owners;
  }
  const paths = tables.map((table) => `${root}/*${suffixOf(table)}`);
  const patterns = ["-e", "^- sys_id: ", "-e", "^  sys_id: "];
  const args = ["grep", "--no-color", ...patterns, tip, "--", ...paths];
  for await (const line of gitLines(args, repository, [0, 1])) {
    const { path, match } = parse(line, tip);
    const sysId = match.replace(/^(- | {2})sys_id: /, "").replace(/^'(.*)'$/, "$1");
    owners.set(sysId, path.slice(root.length + 1, path.indexOf(".children.")));
  }
  return owners;
}
