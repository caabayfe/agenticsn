import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { classesToPull } from "../domain/pull-scope";
import type { RecordChanges } from "../domain/record-changes";
import {
  childPrefixes,
  compareListing,
  hasPrefix,
  isHexPrefixed,
  mirroredRecord,
  verifyStep,
} from "../domain/verify-buckets";
import { type AppliedChanges, applyWithCatalog } from "./apply-with-catalog";
import { forEachConcurrently } from "./concurrently";
import type { IncrementalDependencies } from "./incremental-dependencies";
import type { PullProgress } from "./pull-dependencies";

const SYS_METADATA = TableName.parse("sys_metadata");

export interface RecordVerification {
  readonly scopes: number;
  readonly scopesDiffering: number;
  readonly countRequests: number;
  readonly listedRows: number;
  // Counted by the instance but not listable by this user (ACLs hide rows from listings).
  readonly hiddenRows: number;
  // Records whose legacy sys_id no prefix covers, in parts whose counts disagree.
  readonly unverifiable: number;
}

// One mirrored scope folder can hold records of several scope sys_ids ("" and global).
interface Part {
  readonly scopeIds: readonly string[];
  readonly prefix: string;
  readonly instanceCount: number;
  readonly mirrored: readonly string[];
}

interface Walk {
  readonly deps: IncrementalDependencies;
  readonly excluded: string;
  readonly signal: AbortSignal;
  readonly missing: Map<string, string>;
  readonly missingScopes: Set<string>;
  readonly extra: string[];
  readonly report: {
    countRequests: number;
    listedRows: number;
    hiddenRows: number;
    unverifiable: number;
  };
}

function partQuery(walk: Walk, scopeId: string, prefix: string): string {
  const scope = scopeId === "" ? "sys_scopeISEMPTY" : `sys_scope=${scopeId}`;
  const ids = prefix === "" ? "" : `sys_idSTARTSWITH${prefix}`;
  return [scope, ids, walk.excluded].filter(Boolean).join("^");
}

async function listPart(walk: Walk, part: Part): Promise<void> {
  const instance = new Map<string, string>();
  const scopes = new Map<string, string>();
  for (const scopeId of part.scopeIds) {
    const listing = {
      table: SYS_METADATA,
      fields: ["sys_id", "sys_class_name"],
      kind: "snapshot" as const,
      base: partQuery(walk, scopeId, part.prefix),
    };
    for await (const row of walk.deps.pager.rows(listing, walk.signal)) {
      instance.set(row["sys_id"] ?? "", row["sys_class_name"] ?? "");
      scopes.set(row["sys_id"] ?? "", scopeId);
    }
  }
  walk.report.listedRows += instance.size;
  walk.report.hiddenRows += Math.max(0, part.instanceCount - instance.size);
  const difference = compareListing(instance, part.mirrored);
  for (const [sysId, table] of difference.missing) {
    walk.missing.set(sysId, table);
    walk.missingScopes.add(scopes.get(sysId) ?? "");
  }
  walk.extra.push(...difference.extra);
}

async function splitPart(walk: Walk, part: Part): Promise<void> {
  const children = childPrefixes(part.prefix);
  const counts = new Map<string, number>();
  await forEachConcurrently(children, 4, async (prefix) => {
    let total = 0;
    for (const scopeId of part.scopeIds) {
      walk.report.countRequests += 1;
      total += await walk.deps.statistics.count(
        SYS_METADATA,
        partQuery(walk, scopeId, prefix),
        walk.signal,
      );
    }
    counts.set(prefix, total);
  });
  const covered = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const legacy = part.mirrored.filter((sysId) => !isHexPrefixed(sysId, part.prefix.length + 1));
  walk.report.unverifiable += Math.abs(part.instanceCount - covered - legacy.length);
  for (const prefix of children) {
    const mirrored = part.mirrored.filter((sysId) => hasPrefix(sysId, prefix));
    await walkPart(walk, { ...part, prefix, instanceCount: counts.get(prefix) ?? 0, mirrored });
  }
}

// Counts agree: nothing to do. Small part: list it. Large part: count its 16 sub-prefixes.
async function walkPart(walk: Walk, part: Part): Promise<void> {
  const step = verifyStep(part.instanceCount, part.mirrored.length, part.prefix);
  if (step === "list") {
    await listPart(walk, part);
  } else if (step === "split") {
    await splitPart(walk, part);
  }
}

async function mirroredByScope(deps: IncrementalDependencies): Promise<Map<string, string[]>> {
  const byScope = new Map<string, string[]>();
  for await (const base of deps.records.bases(deps.metadataRoot)) {
    const record = mirroredRecord(base);
    if (record !== null) {
      const ids = byScope.get(record.scope) ?? [];
      ids.push(record.sysId);
      byScope.set(record.scope, ids);
    }
  }
  return byScope;
}

async function instanceByScope(
  deps: IncrementalDependencies,
  catalog: Catalog,
  excluded: string,
  signal: AbortSignal,
): Promise<Map<string, { scopeIds: string[]; count: number }>> {
  const counts = await deps.statistics.countBy(SYS_METADATA, "sys_scope", signal, excluded);
  const byScope = new Map<string, { scopeIds: string[]; count: number }>();
  for (const [scopeId, count] of counts) {
    const scope = String(catalog.scopeNamespace(scopeId));
    const entry = byScope.get(scope) ?? { scopeIds: [], count: 0 };
    entry.scopeIds.push(scopeId);
    entry.count += count;
    byScope.set(scope, entry);
  }
  return byScope;
}

// Classes a pull never mirrors are left out of every count and listing.
function exclusion(catalog: Catalog, unreadable: readonly string[]): string {
  const pulled = new Set(classesToPull(catalog));
  const excluded = [
    ...catalog.metadataClasses().filter((table) => !pulled.has(table)),
    ...unreadable,
  ];
  return excluded.length === 0
    ? ""
    : `sys_class_nameNOT IN${[...new Set(excluded)].sort().join(",")}`;
}

// pull --verify, records: one grouped count per scope, then sys_id-prefix counts and listings
// only where the instance and the mirror disagree (ADR-0016, verification appendix).
export async function verifyRecords(
  deps: IncrementalDependencies,
  catalog: Catalog,
  unreadable: readonly string[],
  signal: AbortSignal,
): Promise<{ changes: RecordChanges; verification: RecordVerification }> {
  const excluded = exclusion(catalog, unreadable);
  const instance = await instanceByScope(deps, catalog, excluded, signal);
  const mirrored = await mirroredByScope(deps);
  const walk: Walk = {
    deps,
    excluded,
    signal,
    missing: new Map(),
    missingScopes: new Set(),
    extra: [],
    report: { countRequests: 1, listedRows: 0, hiddenRows: 0, unverifiable: 0 },
  };
  const scopes = [...new Set([...instance.keys(), ...mirrored.keys()])].sort();
  const parts = scopes.map((scope) => ({
    scopeIds: instance.get(scope)?.scopeIds ?? [],
    prefix: "",
    instanceCount: instance.get(scope)?.count ?? 0,
    mirrored: mirrored.get(scope) ?? [],
  }));
  const differing = parts.filter((part) => part.instanceCount !== part.mirrored.length);
  await forEachConcurrently(differing, 4, (part) => walkPart(walk, part));
  const changed = new Map<string, string[]>();
  for (const [sysId, table] of walk.missing) {
    changed.set(table, [...(changed.get(table) ?? []), sysId]);
  }
  return {
    changes: {
      changed,
      scopes: walk.missingScopes,
      deleted: walk.extra,
      createdBetween: 0,
      deletedBetween: 0,
    },
    verification: { scopes: parts.length, scopesDiffering: differing.length, ...walk.report },
  };
}

export interface VerifiedRecords extends AppliedChanges {
  readonly verification: RecordVerification;
}

// Finds what the mirror lacks or holds in excess, and repairs it.
export async function verifyAndRepairRecords(
  deps: IncrementalDependencies,
  catalog: Catalog,
  unreadable: readonly string[],
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
): Promise<VerifiedRecords> {
  progress({ message: "verifying records" });
  const { changes, verification } = await verifyRecords(deps, catalog, unreadable, signal);
  return { ...(await applyWithCatalog(deps, catalog, changes, signal, progress)), verification };
}
