import { EDITABLE_CHILD_TABLES } from "../../metadata/domain/child-tables";

// Files agents must never edit (ADR-0011, layer 1), relative to the workspace root. Returns why,
// or null when the file may be edited.
const GUARDS =
  "the hooks and permission rules that guard the agent: change them with agent install";

export function protectedReason(path: string): string | null {
  // Compared case-insensitively with / separators: macOS and Windows file systems treat
  // .SNAGENTIC and .snagentic, or \ and /, as the same file.
  const clean = path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
  if (clean.startsWith(".snagentic/")) {
    return "local state that snagentic rebuilds; it is never edited by hand";
  }
  if (clean.startsWith(".git/")) {
    return "git's own files";
  }
  if (/^\.claude\/settings(?:\.local)?\.json$/.test(clean) || clean.startsWith(".github/hooks/")) {
    return GUARDS;
  }
  const child = /^instances\/[^/]+\/metadata\/.*\.children\.([^/]+)\.yaml$/.exec(clean)?.[1];
  if (child !== undefined && !EDITABLE_CHILD_TABLES.has(child)) {
    return "these child rows are read-only copies of the instance (flows, workflows); change the record that owns them";
  }
  if (clean === "waivers.yaml") {
    return "waivers are exceptions a person approves and commits; ask the user to add one";
  }
  if (/^instances\/[^/]+\/instance\.yaml$/.test(clean) || clean === "snagentic.yaml") {
    return "workspace configuration: change it with snagentic instance commands";
  }
  return null;
}
