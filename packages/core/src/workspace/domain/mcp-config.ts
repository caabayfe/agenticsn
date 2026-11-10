// Registers snagentic's MCP server in a host's project config (.mcp.json for Claude Code,
// .vscode/mcp.json for VS Code), so the team's agents get the tools on clone with no manual
// step. A snagentic entry the team already has is kept: it may point at their own binary.

type Json = unknown;

const SERVER_NAME = "snagentic";

const isObject = (value: Json): value is Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// The config file's new text, or null when the existing one cannot be read as a config
// (left as is).
export function withMcpServer(
  existing: string | null,
  key: string,
  server: Readonly<Record<string, Json>>,
): string | null {
  let config: Json = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      config = JSON.parse(existing);
    } catch {
      return null;
    }
  }
  const servers = isObject(config) ? (config[key] ?? {}) : null;
  if (!isObject(config) || !isObject(servers)) {
    return null;
  }
  if (SERVER_NAME in servers && existing !== null) {
    return existing;
  }
  const merged = { ...config, [key]: { ...servers, [SERVER_NAME]: server } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

// The environment variable names a config gives snagentic's server; none when the config can't be
// read. The server inherits them, so they reach every request it sends.
export function mcpServerEnvironment(text: string | null, key: string): string[] {
  let config: Json = null;
  try {
    config = text === null ? null : JSON.parse(text);
  } catch {
    return [];
  }
  const servers = isObject(config) ? config[key] : null;
  const server = isObject(servers) ? servers[SERVER_NAME] : null;
  const env = isObject(server) ? server["env"] : null;
  return isObject(env) ? Object.keys(env) : [];
}
