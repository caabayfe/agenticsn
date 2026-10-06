import { fitted } from "../domain/budget";
import type { IndexedRecord } from "../domain/indexed-record";
import { baseOfFile } from "../domain/paths";
import { freshness } from "./freshness";
import type { Freshness, KnowledgeDependencies, NextCall } from "./knowledge-dependencies";

export interface FindQuery {
  readonly text: string;
  // Search inside scripts and other long fields instead of names.
  readonly code?: boolean;
  readonly className?: string;
  readonly table?: string;
  readonly scope?: string;
  readonly limit: number;
}

export interface FoundRecord {
  readonly path: string;
  readonly name: string;
  readonly className: string;
  readonly table: string | null;
  readonly scope: string;
  readonly active: boolean;
  // For code matches: where the text appears.
  readonly matches?: readonly {
    readonly file: string;
    readonly line: number;
    readonly text: string;
  }[];
  // Matching lines in this record beyond those shown.
  readonly moreMatches?: number;
}

export interface FindResult extends Freshness {
  readonly records: readonly FoundRecord[];
  readonly total: number;
  readonly more: boolean;
  readonly next: readonly NextCall[];
}

const found = (record: IndexedRecord): FoundRecord => ({
  path: `${record.base}.yaml`,
  name: record.name,
  className: record.className,
  table: record.table,
  scope: record.scope,
  active: record.active,
});

// Lines shown per record; the rest are counted. A file read shows them all.
const MATCHES_PER_RECORD = 5;

async function findInCode(deps: KnowledgeDependencies, query: FindQuery) {
  // The word index names candidate records; their files give the exact matches.
  const candidates = await deps.store.containing([query.text], query.limit * 5);
  const hits =
    candidates.length === 0
      ? []
      : await deps.files.grep([query.text], { limit: query.limit * 5, bases: candidates });
  const byBase = new Map<string, { file: string; line: number; text: string }[]>();
  for (const hit of hits) {
    const base = baseOfFile(hit.path);
    byBase.set(base, [
      ...(byBase.get(base) ?? []),
      { file: hit.path, line: hit.line, text: hit.text },
    ]);
  }
  const records = await deps.store.byBases([...byBase.keys()]);
  const kept = records.filter(
    (r) =>
      (query.className === undefined || r.className === query.className) &&
      (query.table === undefined || r.table === query.table),
  );
  return {
    records: kept.slice(0, query.limit).map((r) => {
      const matches = byBase.get(r.base) ?? [];
      return {
        ...found(r),
        matches: matches.slice(0, MATCHES_PER_RECORD),
        ...(matches.length > MATCHES_PER_RECORD
          ? { moreMatches: matches.length - MATCHES_PER_RECORD }
          : {}),
      };
    }),
    total: kept.length,
    more: candidates.length >= query.limit * 5 || kept.length > query.limit,
  };
}

async function findByName(deps: KnowledgeDependencies, query: FindQuery) {
  const searched = await deps.store.search({
    text: query.text,
    limit: query.limit,
    ...(query.className === undefined ? {} : { className: query.className }),
    ...(query.table === undefined ? {} : { table: query.table }),
    ...(query.scope === undefined ? {} : { scope: query.scope }),
  });
  return {
    records: searched.records.map(found),
    total: searched.total,
    more: searched.total > query.limit,
  };
}

// Where something lives: records by name (ranked), or by text in their code.
export async function find(deps: KnowledgeDependencies, query: FindQuery): Promise<FindResult> {
  const result =
    query.code === true ? await findInCode(deps, query) : await findByName(deps, query);
  const first = result.records[0];
  const next: NextCall[] =
    first === undefined
      ? query.code === true
        ? []
        : [{ tool: "find", args: { text: query.text, code: true } }]
      : [{ tool: "describe", args: { target: first.path } }];
  // Trimmed to the budget, best matches kept: `more` tells the agent to narrow the search.
  return fitted(
    (limit) => ({
      ...freshness(deps),
      ...result,
      records: result.records.slice(0, limit),
      more: result.more || result.records.length > limit,
      next,
    }),
    result.records.length,
  );
}
