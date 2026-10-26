import { AccessDeniedError } from "../../index-errors";
import type { Catalog } from "../../metadata/domain/catalog";
import { type SecretRedaction, sortSecretRedactions } from "../../metadata/domain/secret-scan";
import { classesToPull } from "../domain/pull-scope";
import { FIRST_REDACTION_VERSION, rereadsBetween } from "../domain/redaction-upgrades";
import type { SyncState } from "../ports";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { pullClass } from "./pull-records";

export interface RedactionReread {
  // Classes and child tables read again, in the order of the policy's table.
  readonly tables: readonly string[];
  readonly childTables: readonly string[];
  readonly records: number;
  readonly malformedValues: number;
  readonly unreadable: readonly string[];
  readonly secretRedactions: readonly SecretRedaction[];
}

// When the redaction policy is newer than the mirror's, lists again the classes the change
// affects (ADR-0034 #2). Child tables are left to the caller, which lists them as never read.
// Nothing is requested when the versions match.
export async function rereadForRedaction(
  deps: IncrementalDependencies,
  state: SyncState,
  catalog: Catalog,
  signal: AbortSignal,
): Promise<RedactionReread> {
  const from = state.redactionVersion ?? FIRST_REDACTION_VERSION;
  const rereads = rereadsBetween(from, deps.policy.version);
  const mirrored = new Set(classesToPull(catalog));
  const unreadable: string[] = [];
  let records = 0;
  let malformedValues = 0;
  const secretRedactions: SecretRedaction[] = [];
  for (const table of rereads.classes.filter((name) => mirrored.has(name))) {
    try {
      const outcome = await pullClass(table, deps, catalog, signal);
      records += outcome.records;
      malformedValues += outcome.malformed;
      secretRedactions.push(...outcome.secretRedactions);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(table);
    }
  }
  return {
    tables: [...rereads.classes, ...rereads.childTables],
    childTables: rereads.childTables,
    records,
    malformedValues,
    unreadable,
    secretRedactions: sortSecretRedactions(secretRedactions),
  };
}
