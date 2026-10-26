import type { CatalogData } from "../../metadata/domain/catalog";
import {
  SECRET_PATTERN_IDS,
  type SecretPatternId,
  type SecretRedaction,
  scanDocumentSecrets,
  scanSecrets,
  sortSecretRedactions,
} from "../../metadata/domain/secret-scan";
import type { ExistingMirrorFile } from "../ports";

export const SECRET_SCAN_VERSION = 1;

export interface ExistingSecretMigrationMirror {
  existingFiles(root: string): AsyncIterable<ExistingMirrorFile>;
  writeDocument(root: string, path: string, document: unknown): Promise<void>;
  writeText(root: string, path: string, text: string): Promise<void>;
  move(root: string, from: string, to: string): Promise<void>;
}

interface SecretMigrationState {
  readonly secretScanVersion?: number;
}

export interface SecretMigrationResult {
  readonly catalog: CatalogData;
  readonly catalogChanged: boolean;
  readonly secretRedactions: readonly SecretRedaction[];
}

function ordered(found: ReadonlySet<SecretPatternId>): readonly SecretPatternId[] {
  return SECRET_PATTERN_IDS.filter((id) => found.has(id));
}

function scanMap(
  values: Readonly<Record<string, string>>,
  found: Set<SecretPatternId>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const scanned = scanSecrets(value);
      for (const pattern of scanned.patterns) found.add(pattern);
      return [key, scanned.text];
    }),
  );
}

export function scanCatalogSecrets(data: CatalogData): {
  readonly catalog: CatalogData;
  readonly patterns: readonly SecretPatternId[];
} {
  const found = new Set<SecretPatternId>();
  const parents = Object.fromEntries(
    Object.entries(data.parents).map(([table, parent]) => {
      if (parent === null) return [table, null];
      const scanned = scanSecrets(parent);
      for (const pattern of scanned.patterns) found.add(pattern);
      return [table, scanned.text];
    }),
  );
  const typedFields = Object.fromEntries(
    Object.entries(data.typedFields).map(([table, fields]) => [table, scanMap(fields, found)]),
  );
  return {
    catalog: { parents, scopes: scanMap(data.scopes, found), typedFields },
    patterns: ordered(found),
  };
}

async function scanMirrorFile(
  mirror: ExistingSecretMigrationMirror,
  root: string,
  file: ExistingMirrorFile,
): Promise<SecretRedaction | null> {
  const scannedPath = scanSecrets(file.path);
  if (file.kind === "document") {
    const scanned = scanDocumentSecrets(file.document);
    const patterns = ordered(new Set([...scannedPath.patterns, ...scanned.patterns]));
    if (patterns.length === 0) return null;
    if (scannedPath.text !== file.path) await mirror.move(root, file.path, scannedPath.text);
    if (scanned.patterns.length > 0) {
      await mirror.writeDocument(root, scannedPath.text, scanned.document);
    }
    return { path: `${root}/${scannedPath.text}`, patterns };
  }
  const scanned = scanSecrets(file.text);
  const patterns = ordered(new Set([...scannedPath.patterns, ...scanned.patterns]));
  if (patterns.length === 0) return null;
  if (scannedPath.text !== file.path) await mirror.move(root, file.path, scannedPath.text);
  if (scanned.patterns.length > 0) await mirror.writeText(root, scannedPath.text, scanned.text);
  return { path: `${root}/${scannedPath.text}`, patterns };
}

// Rewrites an older committed mirror locally before incremental requests begin (ADR-0035).
// The caller records SECRET_SCAN_VERSION only after the mirror commit succeeds.
export async function migrateExistingSecrets(
  mirror: ExistingSecretMigrationMirror,
  root: string,
  catalogPath: string,
  catalog: CatalogData,
  state: SecretMigrationState,
  signal: AbortSignal,
): Promise<SecretMigrationResult> {
  if ((state.secretScanVersion ?? 0) >= SECRET_SCAN_VERSION) {
    return { catalog, catalogChanged: false, secretRedactions: [] };
  }
  signal.throwIfAborted();
  const secretRedactions: SecretRedaction[] = [];
  for await (const file of mirror.existingFiles(root)) {
    signal.throwIfAborted();
    const redaction = await scanMirrorFile(mirror, root, file);
    if (redaction !== null) secretRedactions.push(redaction);
  }
  const scannedCatalog = scanCatalogSecrets(catalog);
  if (scannedCatalog.patterns.length > 0) {
    secretRedactions.push({ path: catalogPath, patterns: scannedCatalog.patterns });
  }
  return {
    catalog: scannedCatalog.catalog,
    catalogChanged: scannedCatalog.patterns.length > 0,
    secretRedactions: sortSecretRedactions(secretRedactions),
  };
}
