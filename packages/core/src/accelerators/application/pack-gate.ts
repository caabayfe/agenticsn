import { ruleById } from "../../advice/index";
import type { Finding } from "../../governance/index";
import type { InventoryReader } from "../../plugins/index";
import type { PackSource, PackWorkspace } from "../ports";
import { checkPack, listPacks } from "./check-pack";

const RULE = "SN-MNT-012";

interface Owner {
  readonly pack: string;
  readonly capability: string;
}

const sysIdOf = (document: unknown) =>
  document !== null && typeof document === "object" && "sys_id" in document
    ? document.sys_id
    : null;

// A pack's copied records by path, and its patches by target sys_id, each with its capability.
function scan(pack: string, files: ReadonlyMap<string, string>, parse: (text: string) => unknown) {
  const copies = new Map<string, Owner>();
  const patches: { sysId: string; capability: string }[] = [];
  for (const [path, text] of files) {
    const [top, capability = "", ...rest] = path.split("/");
    const sysId = top === "patches" ? sysIdOf(parse(text)) : null;
    if (top === "metadata") copies.set(rest.join("/"), { pack, capability });
    if (typeof sysId === "string") patches.push({ sysId, capability });
  }
  return { copies, patches };
}

// Which capability of a pack each metadata path belongs to: copied records by their path in the
// pack, patched records by their target's path in the mirror (looked up only when needed).
async function owners(
  deps: { readonly packs: PackSource; readonly workspace: PackWorkspace },
  pack: string,
  paths: ReadonlySet<string>,
): Promise<Map<string, Owner>> {
  const parse = (text: string) => deps.workspace.parse(text);
  const { copies: found, patches } = scan(pack, await deps.packs.files(pack), parse);
  const unexplained = [...paths].some((p) => !found.has(p));
  const mirror = unexplained && patches.length > 0 ? await deps.workspace.mirrorCommit() : null;
  if (mirror === null) return found;
  const targets = await deps.workspace.mirrored(
    mirror,
    patches.map((p) => p.sysId),
  );
  for (const patch of patches) {
    const target = targets.get(patch.sysId);
    if (target !== undefined) found.set(target.path, { pack, capability: patch.capability });
  }
  return found;
}

// The gate's accelerator check (ADR-0026, item 2): a planned write of a file a pack added, for
// a capability that is not ready on the instance, is a block finding. Paths are relative to the
// instance's metadata folder.
export async function packFindings(
  deps: {
    readonly packs: PackSource;
    readonly inventory: InventoryReader;
    readonly workspace: PackWorkspace;
  },
  query: {
    readonly instance: { readonly root: string; readonly name: string };
    readonly paths: readonly string[];
    readonly snagentic: string;
  },
): Promise<Finding[]> {
  const rule = ruleById(RULE);
  if (rule === undefined || query.paths.length === 0) return [];
  const findings: Finding[] = [];
  for (const { id } of await listPacks(deps.packs)) {
    const mapped = await owners(deps, id, new Set(query.paths));
    const check = await checkPack(deps, {
      pack: id,
      instance: query.instance,
      snagentic: query.snagentic,
    });
    for (const path of query.paths) {
      const owner = mapped.get(path);
      const state = check.report?.capabilities.find((c) => c.id === owner?.capability);
      if (owner === undefined || state === undefined || state.state === "ready") continue;
      const plugins = state.plugins.filter((p) => p.state !== "active").map((p) => p.id);
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        title: rule.title,
        path,
        field: null,
        line: null,
        message: `capability ${owner.capability} of ${id} is ${state.state}${plugins.length > 0 ? `: ${plugins.join(", ")}` : ""}`,
        evidence: "",
        why: rule.why,
        remediation:
          state.next.length > 0
            ? `${state.next.join("; then ")}; then plan again`
            : rule.remediation,
      });
    }
  }
  return findings;
}
