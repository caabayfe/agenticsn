import { Catalog } from "../../metadata/domain/catalog";
import type { SecretRedaction } from "../../metadata/domain/secret-scan";
import { needsNewCatalog, type RecordChanges } from "../domain/record-changes";
import { fetchCatalog } from "./fetch-catalog";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { applyRecordChanges, type RecordOutcome } from "./incremental-records";
import type { PullProgress } from "./pull-dependencies";
import { scanCatalogSecrets } from "./secret-migration";

export interface AppliedChanges {
  readonly catalog: Catalog;
  readonly catalogRefreshed: boolean;
  readonly catalogSecretRedactions: readonly SecretRedaction[];
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
  let catalogSecretRedactions: readonly SecretRedaction[] = [];
  const catalogRefreshed = needsNewCatalog(changes, catalog);
  if (catalogRefreshed) {
    const data = await fetchCatalog(deps.pager, signal, progress);
    const scanned = scanCatalogSecrets(data);
    await deps.state.writeCatalog(scanned.catalog);
    current = new Catalog(scanned.catalog);
    if (scanned.patterns.length > 0) {
      catalogSecretRedactions = [{ path: deps.catalogPath, patterns: scanned.patterns }];
    }
  }
  const records = await applyRecordChanges(deps, current, changes, signal);
  return { catalog: current, catalogRefreshed, catalogSecretRedactions, records };
}
