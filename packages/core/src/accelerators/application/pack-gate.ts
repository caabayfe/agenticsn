import { ruleById } from "../../advice/index";
import type { Finding } from "../../governance/index";
import type { InventoryReader } from "../../plugins/index";
import { moduleOf, workspacePathOf } from "../domain/pack-layout";
import type { CapabilityReport } from "../domain/preflight";
import type { PackSource } from "../ports";
import { checkPack, listPacks } from "./check-pack";

const RULE = "SN-MNT-012";

// The project (source/<scope>) each pack file is copied into, and the capabilities shipping it.
function owners(files: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const path of files.keys()) {
    const capability = moduleOf(path);
    const project = workspacePathOf(path)?.split("/").slice(0, 2).join("/");
    if (capability === null || project === undefined) continue;
    found.set(project, (found.get(project) ?? new Set()).add(capability));
  }
  return found;
}

function findingOf(pack: string, project: string, state: CapabilityReport): Finding | null {
  const rule = ruleById(RULE);
  if (rule === undefined || state.state === "ready") return null;
  const components = state.components.filter((c) => c.state !== "active").map((c) => c.id);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    title: rule.title,
    path: project,
    root: "workspace",
    field: null,
    line: null,
    message: `module ${state.id} of ${pack} is ${state.state}${components.length > 0 ? `: ${components.join(", ")}` : ""}`,
    evidence: "",
    why: rule.why,
    remediation:
      state.next.length > 0 ? `${state.next.join("; then ")}; then plan again` : rule.remediation,
  };
}

// The gate's accelerator check (ADR-0026, item 2, as amended by ADR-0031): a project with
// planned units that a capability ships files into, while that capability is not ready on the
// instance, is a block finding. Paths are the projects' workspace paths (source/<scope>).
export async function packFindings(
  deps: { readonly packs: PackSource; readonly inventory: InventoryReader },
  query: {
    readonly instance: { readonly root: string; readonly name: string };
    readonly paths: readonly string[];
    readonly snagentic: string;
  },
): Promise<Finding[]> {
  if (query.paths.length === 0) return [];
  const findings: Finding[] = [];
  for (const { id } of await listPacks(deps.packs)) {
    const shipped = owners(await deps.packs.files(id));
    const check = await checkPack(deps, {
      pack: id,
      instance: query.instance,
      snagentic: query.snagentic,
    });
    const states = check.report?.capabilities ?? [];
    for (const project of query.paths) {
      const capabilities = shipped.get(project) ?? new Set<string>();
      const owning = states.filter((state) => capabilities.has(state.id));
      findings.push(...owning.flatMap((state) => findingOf(id, project, state) ?? []));
    }
  }
  return findings;
}
