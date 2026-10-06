import { Catalog } from "../../metadata/domain/catalog";
import { needsNewCatalog, type RecordChanges } from "../domain/record-changes";
import { fetchCatalog } from "./fetch-catalog";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { applyRecordChanges, type RecordOutcome } from "./incremental-records";
import type { PullProgress } from "./pull-dependencies";

export interface AppliedChanges {
  readonly catalog: Catalog;
  readonly catalogRefreshed: boolean;
  readonly records: RecordOutcome;
}

// Applies record changes, reading the catalog again first when it no longer describes them.
export async function applyWithCatalog(
  deps: IncrementalDependencies,
  catalog: Catalog,
  changes: RecordChanges,
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
): Promise<AppliedChanges> {
  let current = catalog;
  const catalogRefreshed = needsNewCatalog(changes, catalog);
  if (catalogRefreshed) {
    const data = await fetchCatalog(deps.pager, signal, progress);
    await deps.state.writeCatalog(data);
    current = new Catalog(data);
  }
  const records = await applyRecordChanges(deps, current, changes, signal);
  return { catalog: current, catalogRefreshed, records };
}
