import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { classesToPull } from "../domain/pull-scope";
import { chunks, type RecordChanges } from "../domain/record-changes";
import {
  type ExplainedRecord,
  explainReread,
  type UnreturnedRecord,
} from "../domain/unstored-records";
import { type AppliedChanges, applyWithCatalog } from "./apply-with-catalog";
import type { IncrementalDependencies } from "./incremental-dependencies";
import type { PullProgress } from "./pull-dependencies";

const SYS_METADATA = TableName.parse("sys_metadata");
// sys_ids per request, as for the downloads: a short URL and one page.
const LOCATE_BATCH = 100;

export interface UnstoredReread {
  readonly applied: AppliedChanges;
  // Records stored now.
  readonly recovered: number;
  // Records still not stored, each with what the instance answered.
  readonly still: readonly ExplainedRecord[];
}

// Where the instance holds the records now: sys_metadata by sys_id (indexed), identities only.
async function locate(
  deps: IncrementalDependencies,
  records: readonly UnreturnedRecord[],
  signal: AbortSignal,
) {
  const listed = new Map<string, string>();
  const scopes = new Set<string>();
  const ids = records.map((record) => record.sysId);
  for (const batch of chunks(ids, LOCATE_BATCH)) {
    const listing = {
      table: SYS_METADATA,
      fields: ["sys_id", "sys_class_name", "sys_scope"],
      kind: "snapshot" as const,
      allDomains: true,
      base: `sys_idIN${batch.join(",")}`,
    };
    for await (const row of deps.pager.rows(listing, signal)) {
      listed.set(row["sys_id"] ?? "", row["sys_class_name"] ?? "");
      scopes.add(row["sys_scope"] ?? "");
    }
  }
  return { listed, scopes };
}

// pull --verify, for the records earlier pulls recorded as unstored: the count comparison cannot
// see one the mirror holds in an earlier copy, so each is asked for again by sys_id. What its
// table returns now is stored; the rest keeps the reason the answers give.
export async function rereadUnstored(
  deps: IncrementalDependencies,
  catalog: Catalog,
  records: readonly UnreturnedRecord[],
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
): Promise<UnstoredReread> {
  progress({ message: "reading unstored records again" });
  const { listed, scopes } = await locate(deps, records, signal);
  const changed = new Map<string, string[]>();
  for (const [sysId, table] of listed) {
    changed.set(table, [...(changed.get(table) ?? []), sysId]);
  }
  const changes: RecordChanges = {
    changed,
    scopes,
    deleted: [],
    createdBetween: 0,
    deletedBetween: 0,
  };
  const applied = await applyWithCatalog(deps, catalog, changes, signal, progress);
  const still = explainReread(records, {
    listed,
    mirrored: new Set(classesToPull(applied.catalog)),
    unreadable: applied.records.unreadable,
    returned: new Set(applied.records.returned),
  });
  return { applied, recovered: applied.records.written + applied.records.renamed, still };
}
