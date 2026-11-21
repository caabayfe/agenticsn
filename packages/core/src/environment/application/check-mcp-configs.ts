import { mcpServerEnvironment } from "../../workspace/domain/mcp-config";
import type { WorkspaceFiles } from "../../workspace/ports";
import type { Check } from "../domain/check";
import { RUNTIME_VARIABLES, riskyVariables } from "../domain/network";

const NAME = "mcp-config";
// The host's own settings: their `env` reaches every command the host starts, hooks included.
const HOST_SETTINGS = [".claude/settings.json", ".claude/settings.local.json"] as const;
const HINT =
  "remove them from snagentic's server entry or the settings file; set a corporate proxy or certificate in your own " +
  "environment instead (docs/guides/network.md)";

// A committed MCP config starts snagentic's server for everyone who clones the workspace, so a
// proxy, certificate or runtime option there would apply to every teammate's credentials.
export async function checkMcpConfigs(
  files: WorkspaceFiles,
  root: string,
  configs: readonly { readonly path: string; readonly key: string; readonly name?: string }[],
  parseToml?: (text: string) => unknown,
): Promise<Check> {
  const findings = new Set<string>();
  for (const config of configs) {
    const text = await files.read(`${root}/${config.path}`);
    const risky = riskyVariables([
      ...new Set([
        ...mcpServerEnvironment(text, config.key, config.name),
        ...mcpServerEnvironment(text, config.key),
      ]),
    ]);
    if (risky.length > 0) {
      findings.add(`${config.path} sets ${risky.join(", ")}`);
    }
  }
  if (parseToml !== undefined) {
    const text = await files.read(`${root}/.codex/config.toml`);
    const risky = riskyVariables(codexEnvironment(text, parseToml));
    if (risky.length > 0) findings.add(`.codex/config.toml sets ${risky.join(", ")}`);
  }
  for (const path of HOST_SETTINGS) {
    const runtime = runtimeVariables(await files.read(`${root}/${path}`));
    if (runtime.length > 0) findings.add(`${path} sets ${runtime.join(", ")}`);
  }
  if (findings.size === 0) {
    const detail = "snagentic's server sets no network or runtime variables";
    return { name: NAME, status: "ok", detail, hint: null };
  }
  return { name: NAME, status: "fail", detail: [...findings].join("; "), hint: HINT };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// A proxy in the host's settings is the person's own network choice; a runtime variable never is.
function runtimeVariables(text: string | null): string[] {
  if (text === null) return [];
  try {
    const settings: unknown = JSON.parse(text);
    const env = record(settings) ? settings["env"] : null;
    const runtime = new Set<string>(RUNTIME_VARIABLES);
    return record(env) ? Object.keys(env).filter((name) => runtime.has(name)) : [];
  } catch {
    return [];
  }
}

function codexEnvironment(text: string | null, parse: (text: string) => unknown): string[] {
  if (text === null) return [];
  try {
    const config = parse(text);
    const servers = record(config) ? config["mcp_servers"] : null;
    if (!record(servers)) return [];
    return Object.entries(servers).flatMap(([name, server]) => {
      const env = record(server) ? server["env"] : null;
      return name.startsWith("snagentic") && record(env) ? Object.keys(env) : [];
    });
  } catch {
    return [];
  }
}
