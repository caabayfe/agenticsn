import {
  appliesTo,
  type CitingPage,
  CONFIG_RECORD_TYPES,
  type ConfigIndex,
  type IndexEntry,
  recordDetails,
  recordName,
  worstStatus,
} from "../domain/config-index";
import type { EvidenceStatus } from "../domain/evidence";
import type { Process } from "../domain/process";
import { pageFile } from "../domain/site-layout";
import type { MirrorRecords } from "../ports";
import type { DocsCheck } from "./check-docs";
import type { Documentation } from "./load-documentation";

interface Citations {
  readonly table: string;
  readonly sysId: string;
  readonly pages: CitingPage[];
  readonly statuses: EvidenceStatus[];
}

function citations(docs: Documentation, process: Process, check: DocsCheck): readonly Citations[] {
  const byRecord = new Map<string, Citations>();
  for (const page of docs.pages.filter((candidate) => candidate.process === process.id)) {
    for (const item of page.evidence) {
      if (item.kind !== "record") {
        continue;
      }
      const key = `${item.table}/${item.sysId}`;
      const entry = byRecord.get(key) ?? {
        table: item.table,
        sysId: item.sysId,
        pages: [],
        statuses: [],
      };
      if (!entry.pages.some((cited) => cited.file === pageFile(page))) {
        entry.pages.push({ file: pageFile(page), title: page.title });
      }
      const result = check.evidence.find(
        (found) => found.page === page.path && found.id === item.id,
      );
      if (result !== undefined) {
        entry.statuses.push(result.status);
      }
      byRecord.set(key, entry);
    }
  }
  return [...byRecord.values()];
}

async function uncited(
  process: Process,
  mirror: MirrorRecords,
  cited: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<readonly IndexEntry[]> {
  if (process.tables.length === 0) {
    return [];
  }
  const found: IndexEntry[] = [];
  for (const type of CONFIG_RECORD_TYPES) {
    for (const listing of await mirror.list(type.table, signal)) {
      const active = listing.fields["active"] !== "false";
      if (
        !active ||
        cited.has(`${type.table}/${listing.sysId}`) ||
        !appliesTo(type, listing.fields, process.tables)
      ) {
        continue;
      }
      const updated = [listing.updatedBy, listing.updatedOn]
        .filter((part) => part !== undefined)
        .join(", ");
      found.push({
        table: type.table,
        sysId: listing.sysId,
        name: recordName(listing.fields),
        details: recordDetails(listing.fields),
        citedBy: [],
        status: null,
        ...(updated === "" ? {} : { updated }),
      });
    }
  }
  return found;
}

// The Configure section's index: every record a page of the process cites, and the active
// records on the process's tables that none cites (spec 010a, A3). Reads only the mirror.
export async function configIndex(
  docs: Documentation,
  process: Process,
  mirror: MirrorRecords,
  check: DocsCheck,
  signal: AbortSignal,
): Promise<ConfigIndex> {
  const cited: IndexEntry[] = [];
  for (const entry of citations(docs, process, check)) {
    signal.throwIfAborted();
    const record = await mirror.read(entry.table, entry.sysId);
    cited.push({
      table: entry.table,
      sysId: entry.sysId,
      name: record === null ? "(gone from the mirror)" : recordName(record.fields),
      details: record === null ? [] : recordDetails(record.fields),
      citedBy: entry.pages,
      status: worstStatus(entry.statuses),
    });
  }
  const keys = new Set(cited.map((record) => `${record.table}/${record.sysId}`));
  return { cited, uncited: await uncited(process, mirror, keys, signal) };
}
