import { type IndexedRecord, indexedRecord } from "../domain/indexed-record";
import type { KnowledgeStore, MirrorFiles } from "../ports";

export interface RefreshOutcome {
  readonly indexed: number;
  readonly removed: number;
  readonly records: number;
  readonly rebuilt: boolean;
}

// A record file is <dir>/<slug>--<sys_id>.yaml with no other dot in its name (ADR-0017).
export function recordBaseOfPath(path: string): string | null {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  return leaf.endsWith(".yaml") && leaf.split(".").length === 2
    ? path.slice(0, -".yaml".length)
    : null;
}

// Brings the index in line with the workspace's files: what was committed since the last
// refresh, what is edited locally now, and what was edited locally last time.
export async function refreshIndex(
  store: KnowledgeStore,
  mirror: MirrorFiles,
): Promise<RefreshOutcome> {
  const head = await mirror.head();
  if (head === null) {
    return { indexed: 0, removed: 0, records: await store.count(), rebuilt: false };
  }
  const marker = await store.marker();
  const changes = await mirror.changes(marker === null ? null : marker.commit);
  const paths = new Set([...changes.committed, ...changes.dirty, ...(marker?.dirty ?? [])]);
  const upserts: IndexedRecord[] = [];
  const removed: string[] = [];
  for (const path of paths) {
    const base = recordBaseOfPath(path);
    if (base === null) {
      continue;
    }
    const record = await mirror.readRecord(path);
    if (record === null) {
      removed.push(base);
    } else {
      upserts.push(indexedRecord(base, record));
    }
  }
  if (marker === null || upserts.length > 0 || removed.length > 0 || marker.commit !== head) {
    await store.apply(upserts, removed, {
      commit: head,
      dirty: changes.dirty.filter((path) => recordBaseOfPath(path) !== null),
    });
  }
  return {
    indexed: upserts.length,
    removed: removed.length,
    records: await store.count(),
    rebuilt: marker === null,
  };
}
