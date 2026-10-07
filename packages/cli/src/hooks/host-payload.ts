import { isAbsolute, resolve } from "node:path";

// The tool call a host hook describes. Hosts disagree on the payload: Claude Code sends
// tool_input.file_path; Copilot CLI sends tool_input.path, or for its patch tool the patch
// text itself; VS Code uses filePath and ignores matchers, so the hook can see any tool.
export interface ToolCall {
  readonly toolName: string | undefined;
  readonly paths: readonly string[];
  readonly command: string | undefined;
}

const PATH_KEYS = ["file_path", "path", "filePath", "notebook_path"] as const;
const PATCH_HEADER = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;
const EDIT_TOOL = /edit|write|create|patch|replace|insert/i;
const SHELL_TOOL = /bash|shell|terminal|powershell/i;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toolInput(payload: Record<string, unknown>): unknown {
  const input = payload["tool_input"] ?? payload["toolArgs"];
  // Copilot's camelCase payloads carry the arguments as a JSON string.
  return payload["tool_input"] === undefined && typeof input === "string"
    ? parsedJson(input)
    : input;
}

function pathsOf(input: unknown): string[] {
  if (typeof input === "string") {
    return [...input.matchAll(PATCH_HEADER)].flatMap((match) => text(match[1]?.trim()) ?? []);
  }
  const fields = record(input);
  return PATH_KEYS.flatMap((key) => text(fields[key]) ?? []);
}

export function toolCallOf(payload: unknown): ToolCall {
  const fields = record(payload);
  const input = toolInput(fields);
  const cwd = text(fields["cwd"]);
  const absolute = (path: string) =>
    cwd !== undefined && isAbsolute(cwd) && !isAbsolute(path) ? resolve(cwd, path) : path;
  return {
    toolName: text(fields["tool_name"]) ?? text(fields["toolName"]),
    paths: [...new Set(pathsOf(input).map(absolute))],
    command: text(record(input)["command"]),
  };
}

// A missing tool name means the host matched the hook to the tool already.
export const isEditTool = (call: ToolCall): boolean =>
  call.toolName === undefined || EDIT_TOOL.test(call.toolName);

export const isShellTool = (call: ToolCall): boolean =>
  call.toolName === undefined || SHELL_TOOL.test(call.toolName);
