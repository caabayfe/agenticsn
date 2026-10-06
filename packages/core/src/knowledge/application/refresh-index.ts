import { forEachConcurrently } from "../../sync/application/concurrently";
import { chunks } from "../../sync/domain/record-changes";
import { indexedRecord } from "../domain/indexed-record";
import { baseOfFile } from "../domain/paths";
import type { IndexedDocument, KnowledgeStore, MirrorFiles } from "../ports";

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
  // Any changed file of a record (its YAML, a script, its child rows) re-reads the record.
  const paths = [...changes.committed, ...changes.dirty, ...(marker?.dirty ?? [])];
  const bases = [...new Set(paths.map(baseOfFile))];
  let indexed = 0;
  let removed = 0;
  for (const batch of chunks(bases, BATCH)) {
    const upserts: IndexedDocument[] = [];
    const gone: string[] = [];
    await forEachConcurrently(batch, READERS, async (base) => {
      const document = await mirror.readDocument(base);
      if (document.record === null) {
        gone.push(base);
      } else {
        upserts.push({ record: indexedRecord(base, document.record), text: document.text });
      }
    });
    await store.apply(upserts, gone, null);
    indexed += upserts.length;
    removed += gone.length;
  }
  if (marker === null || bases.length > 0 || marker.commit !== head) {
    await store.apply([], [], { commit: head, dirty: changes.dirty });
  }
  return { indexed, removed, records: await store.count(), rebuilt: marker === null };
}
