import { canonicalJson } from "../../kernel/canonical-json";
import { sha256Hex } from "../../kernel/sha256";
import type { CatalogData } from "../../metadata/domain/catalog";
import type { SecretPatternId } from "../../metadata/domain/secret-scan";
import type { PullStateStore } from "../ports";
import { type CatalogProgress, fetchCatalog } from "./fetch-catalog";
import type { KeysetPager } from "./keyset-pager";
import { scanCatalogSecrets } from "./secret-migration";

interface CatalogDependencies {
  readonly pager: KeysetPager;
  readonly state: PullStateStore;
}

export interface ReadCatalog {
  readonly catalog: CatalogData;
  readonly patterns: readonly SecretPatternId[];
}

export function catalogDigest(data: CatalogData): string {
  const { parents, scopes, typedFields } = data;
  return sha256Hex(canonicalJson({ parents, scopes, typedFields }));
}

// Reads the catalog from the instance, scanned as every file a pull writes (ADR-0035), and notes
// on this clone that redaction may rely on it.
export async function fetchTrustedCatalog(
  deps: CatalogDependencies,
  signal: AbortSignal,
  progress?: (event: CatalogProgress) => void,
): Promise<ReadCatalog> {
  const scanned = scanCatalogSecrets(await fetchCatalog(deps.pager, signal, progress));
  await deps.state.noteTrust({ catalogDigest: catalogDigest(scanned.catalog) });
  return scanned;
}

// The catalog a pull that writes instance data decides redaction with (spec 014, SEC2-03).
// Password-typed fields and the classes that extend a credential class come from the catalog,
// and a mirror commit's catalog.yaml is data, not trust (ADR-0052 item 7): it is used only when
// this clone read the same catalog from the instance itself. Otherwise the instance's is read
// (one catalog read per clone and dictionary change) and written over the mirror's.
export async function trustedCatalog(
  deps: CatalogDependencies,
  stored: CatalogData,
  signal: AbortSignal,
  progress?: (event: CatalogProgress) => void,
): Promise<ReadCatalog & { readonly changed: boolean }> {
  const digest = catalogDigest(stored);
  if ((await deps.state.readTrust()).catalogDigest === digest) {
    return { catalog: stored, patterns: [], changed: false };
  }
  const read = await fetchTrustedCatalog(deps, signal, progress);
  const changed = catalogDigest(read.catalog) !== digest;
  if (changed) await deps.state.writeCatalog(read.catalog);
  return { ...read, patterns: changed ? read.patterns : [], changed };
}
