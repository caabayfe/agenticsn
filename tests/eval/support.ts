import type { ToolCall, Trace, WorkspaceChanges } from "../../scripts/eval/types";

// Hand-written traces for the checks' tests: what a host would have recorded.
export const SLOT = "/tmp/snagentic-eval/slot-1";

export const call = (
  name: string,
  input: Record<string, unknown> = {},
  extra: Partial<ToolCall> = {},
): ToolCall => ({ name, input, result: "", isError: false, turn: 0, ...extra });

export const trace = (calls: ToolCall[], replies: string[] = [""]): Trace => ({
  calls,
  replies,
  skillsAvailable: [],
  costUsd: 0,
  seconds: 0,
  model: "m",
  error: null,
});

export const NONE: WorkspaceChanges = { changed: [], validatePassed: null };
export const changed = (...paths: string[]): WorkspaceChanges => ({
  changed: paths,
  validatePassed: null,
});

// An MCP tool of the develop profile, as the shipped .mcp.json names its server.
export const tool = (name: string, extra: Partial<ToolCall> = {}, input = {}) =>
  call(`mcp__snagentic-develop__${name}`, input, extra);
export const cli = (command: string, extra: Partial<ToolCall> = {}) =>
  call("Bash", { command }, extra);
export const edit = (path: string, text = "", extra: Partial<ToolCall> = {}) =>
  call("Edit", { file_path: `${SLOT}/${path}`, new_string: text }, extra);

export const SOURCE = "source/x_snag_eval/src/server/reopen-note.js";
export const MIRROR = "instances/pdi/metadata/global/sys_script/rule--0123.script.js";
