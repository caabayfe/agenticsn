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
  // They start the snagentic server, and could give it an environment that runs other code.
  if (clean === ".mcp.json" || clean === ".vscode/mcp.json") {
    return GUARDS;
  }
  if (/^instances\/[^/]+\/metadata\//.test(clean)) {
    return "the mirror is the instance as last pulled, written only by pull (ADR-0031): adopt the record with snagentic adopt, then edit its source under source/<scope>/";
  }
  if (/^source\/[^/]+\/snagentic\.ledger\.yaml$/.test(clean)) {
    return "the ledger records what the instance held when it last agreed with source; adopt and push write it";
  }
  if (clean === "waivers.yaml") {
    return "waivers are exceptions a person approves and commits; ask the user to add one";
  }
  if (/^instances\/[^/]+\/instance\.yaml$/.test(clean) || clean === "snagentic.yaml") {
    return "workspace configuration: change it with snagentic instance commands";
  }
  return null;
}
