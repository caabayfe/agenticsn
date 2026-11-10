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
  configs: readonly { readonly path: string; readonly key: string }[],
): Promise<Check> {
  const findings: string[] = [];
  for (const config of configs) {
    const text = await files.read(`${root}/${config.path}`);
    const risky = riskyVariables(mcpServerEnvironment(text, config.key));
    if (risky.length > 0) {
      findings.push(`${config.path} sets ${risky.join(", ")}`);
    }
  }
  if (findings.length === 0) {
    const detail = "snagentic's server sets no network or runtime variables";
    return { name: NAME, status: "ok", detail, hint: null };
  }
  return { name: NAME, status: "fail", detail: findings.join("; "), hint: HINT };
}
