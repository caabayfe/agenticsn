import type { CheckResult, ToolCall } from "./types";

// What the checks ask of one tool call. Paths in a trace are absolute (the slot's), paths in
// the workspace's changes are relative: the patterns below match both.

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const result = (id: string, passed: boolean, detail: string): CheckResult => ({
  id,
  passed,
  detail,
});

export const commandOf = (call: ToolCall) =>
  call.name === "Bash" ? String(call.input["command"] ?? "") : "";

// An MCP tool call, from either profile's server (snagentic-investigate, snagentic-develop) or
// the single server of 1.x, or the same tool through the CLI (`snagentic plan-push` for
// plan_push), which agents use when they have no MCP server.
export const isTool = (call: ToolCall, tool: string) =>
  new RegExp(`^mcp__snagentic(-[a-z]+)?__${tool}$`).test(call.name) ||
  new RegExp(`(^|[;&|\\s])snagentic ${tool.replaceAll("_", "-")}(\\s|$)`).test(commandOf(call));

export const pathOf = (call: ToolCall) =>
  typeof call.input["file_path"] === "string" ? call.input["file_path"] : "";

export const isEdit = (call: ToolCall) => EDIT_TOOLS.has(call.name);

// Where a path lies in a workspace (ADR-0031): only `source` is the agent's to edit.
export type Zone = "mirror" | "ledger" | "source" | "waivers" | "state" | "config" | "other";

const ZONES: readonly (readonly [Zone, RegExp])[] = [
  ["state", /(^|\/)\.snagentic\//],
  ["mirror", /(^|\/)instances\/[^/]+\/(metadata|pull)\//],
  ["config", /(^|\/)(instances\/[^/]+\/instance\.yaml|snagentic\.yaml)$/],
  ["ledger", /(^|\/)source\/[^/]+\/snagentic\.ledger\.yaml$/],
  ["source", /(^|\/)source\//],
  ["waivers", /(^|\/)waivers\.yaml$/],
];

export const zoneOf = (path: string): Zone =>
  ZONES.find(([, pattern]) => pattern.test(path))?.[0] ?? "other";

export const editsIn = (calls: readonly ToolCall[], zone: Zone) =>
  calls.filter((call) => isEdit(call) && zoneOf(pathOf(call)) === zone);

const text = (value: unknown) => (typeof value === "string" ? value : "");

// The text an edit put into its file.
export function written(call: ToolCall): string {
  const edits = Array.isArray(call.input["edits"]) ? call.input["edits"] : [];
  return [
    text(call.input["content"]),
    text(call.input["new_string"]),
    ...edits.map((item: { new_string?: unknown }) => text(item.new_string)),
  ].join("\n");
}

const base = (path: string) => path.split("/").at(-1) ?? path;
export const names = (paths: readonly string[]) => paths.slice(0, 3).map(base).join(", ");
