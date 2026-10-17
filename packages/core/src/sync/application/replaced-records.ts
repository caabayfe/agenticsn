import { TableName } from "../../kernel/table-name";
import { identityFolder, recordAddress } from "../../metadata/domain/record-layout";
import type { IncrementalDependencies } from "./incremental-dependencies";

// Classes the platform replaces when they are saved: its related list editor, and loading a
// "Related Lists" update (ADR-0030, spike S15), deletes a form's related lists record and creates
// it again under a new sys_id, without a deletion record. Pull would keep the old file forever.
const REPLACED_ON_SAVE = new Set(["sys_ui_related_list"]);

// A record file's name without its sys_id: <scope>/<class>/<name>, in any domain.
function nameKey(base: string): string | null {
  const address = recordAddress(base);
  if (address === null) return null;
  const leaf = base.slice(base.lastIndexOf("/") + 1).replace(/--[0-9a-f]{32}$/, "");
  return `${identityFolder(address.folder)}/${leaf}`;
}

// Removes the mirrored records that a record created in this pull replaced: same class folder
// and file name (the table and view), a different sys_id, and no longer on the instance. Asks
// the instance once, and only when this pull created such a record. Returns how many it removed.
export async function removeReplaced(
  deps: IncrementalDependencies,
  created: readonly { readonly base: string; readonly className: string }[],
  signal: AbortSignal,
): Promise<number> {
  const fresh = created.filter((c) => REPLACED_ON_SAVE.has(c.className));
  if (fresh.length === 0) return 0;
  const freshBases = new Set(fresh.map((c) => c.base));
  const wanted = new Map(fresh.map((c) => [nameKey(c.base), c.className]));
  const candidates: { base: string; sysId: string; className: string }[] = [];
  for await (const base of deps.records.bases(deps.metadataRoot)) {
    const className = wanted.get(nameKey(base));
    const sysId = recordAddress(base)?.sysId;
    if (className !== undefined && sysId !== undefined && !freshBases.has(base)) {
      candidates.push({ base, sysId, className });
    }
  }
  let removed = 0;
  for (const className of new Set(candidates.map((c) => c.className))) {
    const ofClass = candidates.filter((c) => c.className === className);
    const listing = {
      table: TableName.parse(className),
      fields: ["sys_id"],
      kind: "snapshot" as const,
      allDomains: true,
      base: `sys_idIN${ofClass.map((c) => c.sysId).join(",")}`,
    };
    const present = new Set<string>();
    for await (const row of deps.pager.rows(listing, signal)) present.add(row["sys_id"] ?? "");
    for (const gone of ofClass.filter((c) => !present.has(c.sysId))) {
      for (const path of deps.records.filesOf(deps.metadataRoot, gone.base)) {
        await deps.records.remove(deps.metadataRoot, path);
      }
      removed += 1;
    }
  }
  return removed;
}
