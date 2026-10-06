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

async function findInCode(deps: KnowledgeDependencies, query: FindQuery) {
  const hits = await deps.files.grep([query.text], { limit: query.limit * 5 });
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
    records: kept
      .slice(0, query.limit)
      .map((r) => ({ ...found(r), matches: byBase.get(r.base) ?? [] })),
    total: kept.length,
    more: hits.length >= query.limit * 5 || kept.length > query.limit,
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
  return { ...freshness(deps), ...result, next };
}
