import {
  ancestorsOf,
  CENSUS_SIGNALS,
  type CensusGroup,
  type CensusRecord,
  censusOf,
  reaches,
} from "../domain/census";
import { UnknownProcessError } from "../domain/errors";
import { claiming, type ProcessFeatures, undecided } from "../domain/features";
import type { Process } from "../domain/process";
import type { DocumentationSources, MirrorListing, MirrorRecords } from "../ports";
import { loadDocumentation } from "./load-documentation";

// The records of a table whose field holds one of the values; the mirror filters them itself
// when it can (the dictionary has 143,000 entries on a PDI).
function matching(
  mirror: MirrorRecords,
  table: string,
  field: string,
  values: readonly string[],
  signal: AbortSignal,
): Promise<readonly MirrorListing[]> {
  if (mirror.find !== undefined) return mirror.find(table, field, values, signal);
  return mirror
    .list(table, signal)
    .then((all) => all.filter((item) => values.includes(item.fields[field] ?? "")));
}

const recordOf = (listing: MirrorListing): CensusRecord => ({
  sysId: listing.sysId,
  scope: listing.scope ?? "global",
  fields: listing.fields,
});

// Each application's name, from its menus (sys_app_application), the shortest title.
async function titles(mirror: MirrorRecords, signal: AbortSignal) {
  const names = new Map<string, string>();
  for (const menu of await mirror.list("sys_app_application", signal)) {
    const title = menu.fields["title"]?.trim() ?? "";
    const scope = menu.scope ?? "global";
    const known = names.get(scope);
    if (title !== "" && (known === undefined || title.length < known.length)) {
      names.set(scope, title);
    }
  }
  return names;
}

// Every application that reaches the process's tables, with what it adds (ADR-0040).
export async function takeCensus(
  process: Process,
  mirror: MirrorRecords,
  signal: AbortSignal,
): Promise<readonly CensusGroup[]> {
  if (process.tables.length === 0) return [];
  const ancestors = ancestorsOf(process.tables, await mirror.list("sys_db_object", signal));
  const found = [];
  for (const signalDefinition of CENSUS_SIGNALS) {
    const values =
      signalDefinition.inherit === "none" ? process.tables : [...process.tables, ...ancestors];
    const records = (
      await matching(mirror, signalDefinition.table, signalDefinition.field, values, signal)
    )
      .map(recordOf)
      .filter((record) => reaches(signalDefinition, record, process.tables, ancestors));
    found.push({ signal: signalDefinition, records });
  }
  return censusOf(found, await titles(mirror, signal));
}

export interface CensusResult {
  readonly process: string;
  readonly tables: readonly string[];
  readonly groups: readonly (CensusGroup & { readonly features: readonly string[] })[];
  // features.yaml, when the process has one.
  readonly declared: ProcessFeatures | null;
  // What no feature claims: every group without a features.yaml.
  readonly undecided: readonly CensusGroup[];
}

export async function docsCensus(
  deps: {
    readonly sources: DocumentationSources;
    readonly mirror: (instance: string) => MirrorRecords;
    readonly root: string;
    readonly signal: AbortSignal;
  },
  processId: string,
): Promise<CensusResult> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const process = docs.processes.find((item) => item.id === processId);
  if (process === undefined) {
    throw new UnknownProcessError(
      processId,
      docs.processes.map((item) => item.id),
    );
  }
  const groups = await takeCensus(process, deps.mirror(docs.config.instance), deps.signal);
  const declared = docs.features.find((item) => item.process === processId) ?? null;
  return {
    process: processId,
    tables: process.tables,
    groups: groups.map((group) => ({ ...group, features: claiming(declared, group.scope) })),
    declared,
    undecided: declared === null ? groups : undecided(groups, declared),
  };
}
