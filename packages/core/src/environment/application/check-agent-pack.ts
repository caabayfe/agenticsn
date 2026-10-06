import { installedPackVersion } from "../../workspace/domain/agent-pack";
import type { WorkspaceFiles } from "../../workspace/ports";
import type { Check } from "../domain/check";

const HINT = "run snagentic agent install, then commit the files";

// Whether the workspace's agent pack matches this binary: skills and instructions name the
// tools and fields of the version that wrote them (spec 003, section 5.4).
export async function checkAgentPack(
  files: WorkspaceFiles,
  root: string,
  version: string,
): Promise<Check> {
  const installed = installedPackVersion(await files.read(`${root}/AGENTS.md`));
  if (installed === version) {
    return { name: "agent-pack", status: "ok", detail: `${installed} installed`, hint: null };
  }
  return {
    name: "agent-pack",
    status: "warn",
    detail:
      installed === null
        ? "not installed in this workspace"
        : `${installed} installed; this is snagentic ${version}`,
    hint: HINT,
  };
}
