import { ruleById } from "../../advice/index";
import type { Finding } from "../../governance/index";
import type { InventoryReader } from "../../plugins/index";
import { moduleOf, workspacePathOf } from "../domain/pack-layout";
import type { CapabilityReport } from "../domain/preflight";
import type { PackSource } from "../ports";
import { checkPack, listPacks } from "./check-pack";

const RULE = "SN-MNT-012";

// A planned unit's record, as the plan names it.
export interface GatedUnit {
  readonly project: string;
  readonly sysId: string;
}

// The fixed record ids each capability's source declares (`$id: '<32 hex>'`, the pack's rule
// for record ids): what lets the gate tell which module a planned unit belongs to.
function declaredIds(files: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [path, text] of files) {
    const capability = moduleOf(path);
    if (capability === null) continue;
    const ids = found.get(capability) ?? new Set<string>();
    for (const match of text.matchAll(/\$id:\s*['"]([0-9a-f]{32})['"]/g))
      if (match[1]) ids.add(match[1]);
    found.set(capability, ids);
  }
  return found;
}

// Whether the planned units touch a capability: one of its records is planned. A capability
// whose source declares no fixed id cannot be told apart, so any planned unit counts.
function touches(ids: ReadonlySet<string> | undefined, units: readonly GatedUnit[]): boolean {
  if (ids === undefined || ids.size === 0) return units.length > 0;
  return units.some((u) => ids.has(u.sysId));
}

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
// Given the planned units, only a capability whose own records are planned blocks, so a
// module that is not ready never stops the others' records (owner, 2026-10-24).
export async function packFindings(
  deps: { readonly packs: PackSource; readonly inventory: InventoryReader },
  query: {
    readonly instance: { readonly root: string; readonly name: string };
    readonly paths: readonly string[];
    readonly snagentic: string;
    readonly units?: readonly GatedUnit[];
  },
): Promise<Finding[]> {
  if (query.paths.length === 0) return [];
  const findings: Finding[] = [];
  for (const { id } of await listPacks(deps.packs)) {
    const files = await deps.packs.files(id);
    const shipped = owners(files);
    const ids = query.units === undefined ? null : declaredIds(files);
    const check = await checkPack(deps, {
      pack: id,
      instance: query.instance,
      snagentic: query.snagentic,
    });
    const states = check.report?.capabilities ?? [];
    for (const project of query.paths) {
      const capabilities = shipped.get(project) ?? new Set<string>();
      const planned = (query.units ?? []).filter((u) => u.project === project);
      const owning = states.filter(
        (state) =>
          capabilities.has(state.id) && (ids === null || touches(ids.get(state.id), planned)),
      );
      findings.push(...owning.flatMap((state) => findingOf(id, project, state) ?? []));
    }
  }
  return findings;
}
