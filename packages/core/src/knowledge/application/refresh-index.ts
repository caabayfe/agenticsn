import { forEachConcurrently } from "../../sync/application/concurrently";
import { chunks } from "../../sync/domain/record-changes";
import { type IndexedRecord, indexedRecord } from "../domain/indexed-record";
import { recordBaseOfPath } from "../domain/paths";
import type { KnowledgeStore, MirrorFiles } from "../ports";

export interface RefreshOutcome {
  readonly indexed: number;
  readonly removed: number;
  readonly records: number;
  readonly rebuilt: boolean;
}

// Records read and written per batch: bounds memory on a first build of a large instance.
const BATCH = 5000;
const READERS = 16;

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
  const paths = [
    ...new Set([...changes.committed, ...changes.dirty, ...(marker?.dirty ?? [])]),
  ].filter((path) => recordBaseOfPath(path) !== null);
  let indexed = 0;
  let removed = 0;
  for (const batch of chunks(paths, BATCH)) {
    const upserts: IndexedRecord[] = [];
    const gone: string[] = [];
    await forEachConcurrently(batch, READERS, async (path) => {
      const base = recordBaseOfPath(path) ?? "";
      const record = await mirror.readRecord(path);
      if (record === null) {
        gone.push(base);
      } else {
        upserts.push(indexedRecord(base, record));
      }
    });
    await store.apply(upserts, gone, null);
    indexed += upserts.length;
    removed += gone.length;
  }
  if (marker === null || paths.length > 0 || marker.commit !== head) {
    const dirty = changes.dirty.filter((path) => recordBaseOfPath(path) !== null);
    await store.apply([], [], { commit: head, dirty });
  }
  return { indexed, removed, records: await store.count(), rebuilt: marker === null };
}
