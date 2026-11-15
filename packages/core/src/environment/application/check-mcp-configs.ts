import { mcpServerEnvironment } from "../../workspace/domain/mcp-config";
import type { WorkspaceFiles } from "../../workspace/ports";
import type { Check } from "../domain/check";
import { riskyVariables } from "../domain/network";

const NAME = "mcp-config";
const HINT =
  "remove them from snagentic's server entry; set a corporate proxy or certificate in your own " +
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
  if (findings.size === 0) {
    const detail = "snagentic's server sets no network or runtime variables";
    return { name: NAME, status: "ok", detail, hint: null };
  }
  return { name: NAME, status: "fail", detail: [...findings].join("; "), hint: HINT };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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
