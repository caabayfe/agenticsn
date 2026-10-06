// Files agents must never edit (ADR-0011, layer 1), relative to the workspace root. Returns why,
// or null when the file may be edited.
export function protectedReason(path: string): string | null {
  const clean = path.replace(/^\.\//, "");
  if (clean.startsWith(".snagentic/")) {
    return "local state that snagentic rebuilds; it is never edited by hand";
  }
  if (clean.startsWith(".git/")) {
    return "git's own files";
  }
  if (/^instances\/[^/]+\/metadata\/.*\.children\.[^/]+\.yaml$/.test(clean)) {
    return "child rows are read-only copies of the instance; change the record that owns them";
  }
  if (/^instances\/[^/]+\/instance\.yaml$/.test(clean) || clean === "snagentic.yaml") {
    return "workspace configuration: change it with snagentic instance commands";
  }
  return null;
}
