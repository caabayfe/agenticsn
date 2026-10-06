// ADR-0017 paths, relative to instances/<name>/metadata. A record's YAML is
// <dir>/<slug>--<sys_id>.yaml (no other dot in its name); its other files share that base
// and add a suffix (.script.js, .children.<table>.yaml).

export function recordBaseOfPath(path: string): string | null {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  return leaf.endsWith(".yaml") && leaf.split(".").length === 2
    ? path.slice(0, -".yaml".length)
    : null;
}

// The record a file belongs to (its base), whichever of the record's files it is.
export function baseOfFile(path: string): string {
  const leafStart = path.lastIndexOf("/") + 1;
  const dot = path.indexOf(".", leafStart);
  return dot < 0 ? path : path.slice(0, dot);
}
