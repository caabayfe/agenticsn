import type { InventoryReader } from "../../plugins/index";
import { PackNotAddableError } from "../domain/errors";
import { materialize, RECORD_FILE } from "../domain/materialize";
import { carried } from "../domain/upgrade";
import type { PackSource, PackWorkspace } from "../ports";
import { checkPack } from "./check-pack";

export interface AddQuery {
  readonly pack: string;
  readonly instance: { readonly root: string; readonly name: string };
  readonly waves?: readonly number[];
  readonly capabilities?: readonly string[];
  readonly snagentic: string;
}

export interface AddResult {
  readonly pack: string;
  readonly version: string;
  readonly selected: readonly string[];
  readonly branch: string;
  readonly commit: string;
  readonly copied: number;
  readonly patched: number;
  // Files the last add wrote that this version no longer ships: kept, never deleted (M8).
  readonly removed: readonly string[];
  // Files the merge left in conflict with the user's edits: resolve them, then commit.
  readonly conflicts: readonly string[];
}

// The sys_ids to look up in the mirror at once: the records the selected capabilities create
// (they may be there from an earlier add) and those their patches name.
function patchTargets(
  files: ReadonlyMap<string, string>,
  selected: readonly string[],
  parse: (text: string) => unknown,
): string[] {
  return [...files.entries()].flatMap(([path, text]) => {
    const [top, capability, ...rest] = path.split("/");
    if (!selected.includes(capability ?? "")) return [];
    // A record the pack creates may already be on the instance, from an earlier add.
    const record = top === "metadata" ? RECORD_FILE.exec(rest.join("/")) : null;
    if (record !== null) return [record[2] ?? ""];
    if (top !== "patches") return [];
    const document = parse(text);
    const sysId =
      document !== null && typeof document === "object" && "sys_id" in document
        ? document.sys_id
        : undefined;
    return typeof sysId === "string" ? [sysId] : [];
  });
}

// Writes a pack's selected capabilities into the workspace: new records as files, patches on
// the mirrored records, committed to the pack branch and merged (ADR-0026, item 2). Nothing on
// the instance changes; plan_push and push deliver it.
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
    ...check.unknown.map((u) => `the pack has no capability ${u}`),
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
  const records = await deps.workspace.mirrored(mirror, patchTargets(files, check.selected, parse));
  const result = materialize({
    selected: check.selected,
    files,
    parse,
    mirrored: (sysId) => records.get(sysId) ?? null,
  });
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
    version: check.pack.version,
    selected: check.selected,
    branch,
    commit,
    copied: result.files.filter((f) => f.kind === "copy").length,
    patched: result.files.filter((f) => f.kind === "patch").length,
    removed,
    conflicts,
  };
}
