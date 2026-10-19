import type { InventoryReader } from "../../plugins/index";
import type { Selection } from "../domain/capability-graph";
import { PackNotAddableError } from "../domain/errors";
import { type Adoption, materialize } from "../domain/materialize";
import { carried } from "../domain/upgrade";
import type { PackSource, PackWorkspace } from "../ports";
import { checkPack } from "./check-pack";

export interface AddQuery extends Selection {
  readonly pack: string;
  readonly instance: { readonly root: string; readonly name: string };
  readonly snagentic: string;
}

export interface AddResult {
  readonly pack: string;
  readonly instance: string;
  readonly version: string;
  readonly selected: readonly string[];
  readonly branch: string;
  readonly commit: string;
  // Workspace paths of the Fluent source files written.
  readonly copied: readonly string[];
  // Out-of-box records the selection customizes: adopt each, then edit it as its note says.
  readonly adoptions: readonly Adoption[];
  // Files the last add wrote that this version no longer ships: kept, never deleted (M8).
  readonly removed: readonly string[];
  // Files the merge left in conflict with the user's edits: resolve them, then commit.
  readonly conflicts: readonly string[];
}

// Writes a pack's selected modules into the workspace: their Fluent source into the
// projects under source/, committed to the pack branch and merged (ADR-0026, item 2, as amended
// by ADR-0031), and lists the out-of-box records to adopt. Nothing on the instance changes;
// plan_push and push deliver it.
export async function addPack(
  deps: {
    readonly packs: PackSource;
    readonly inventory: InventoryReader;
    readonly workspace: PackWorkspace;
  },
  query: AddQuery,
): Promise<AddResult> {
  const check = await checkPack(deps, query);
  const problems = [
    ...check.unknown.map((u) => `the pack has no ${u.startsWith("profile ") ? u : `module ${u}`}`),
    ...(check.report?.problems ?? []),
    ...(check.report?.capabilities ?? [])
      .filter((c) => c.state !== "ready")
      .map((c) => `${c.id} is ${c.state}`),
  ];
  const mirror = await deps.workspace.mirrorCommit();
  if (check.report === null || mirror === null) problems.push(`pull ${query.instance.name} first`);
  else if (!(await deps.workspace.includes(mirror))) {
    problems.push(`integrate ${query.instance.name} first: the latest pull is not merged`);
  }
  if (problems.length > 0 || mirror === null) throw new PackNotAddableError(query.pack, problems);
  const files = await deps.packs.files(query.pack);
  const parse = (text: string) => deps.workspace.parse(text);
  const result = materialize({ selected: check.selected, files, parse });
  if (result.problems.length > 0) throw new PackNotAddableError(query.pack, result.problems);
  const message = `snagentic accelerator add ${query.pack} ${check.pack.version}: ${check.selected.join(", ")}`;
  const { keep, removed } = carried(
    await deps.workspace.previous(query.pack),
    result.files.map((f) => f.path),
  );
  const commit = await deps.workspace.commit(query.pack, mirror, result.files, message, keep);
  const { branch, conflicts } = await deps.workspace.merge(query.pack);
  return {
    pack: query.pack,
    instance: query.instance.name,
    version: check.pack.version,
    selected: check.selected,
    branch,
    commit,
    copied: result.files.map((f) => f.path),
    adoptions: result.adoptions,
    removed,
    conflicts,
  };
}
