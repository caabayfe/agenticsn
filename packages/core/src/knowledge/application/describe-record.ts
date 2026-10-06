import { SnagenticError } from "../../kernel/errors";
import type { IndexedRecord } from "../domain/indexed-record";
import { baseOfFile, recordBaseOfPath } from "../domain/paths";
import { freshness } from "./freshness";
import type { Freshness, KnowledgeDependencies, NextCall } from "./knowledge-dependencies";

// References gathered per record before the rest is only counted.
const USED_BY_LIMIT = 25;

export class RecordNotFoundError extends SnagenticError {
  constructor(target: string) {
    super(
      "record-not-found",
      "precondition",
      `no mirrored record matches ${target}`,
      "search for it with find, or pull if it was created recently",
    );
  }
}

export interface UsedBy {
  readonly path: string;
  readonly name: string;
  readonly className: string;
  readonly line: number;
  readonly text: string;
}

export interface RecordDescription extends Freshness {
  readonly path: string;
  readonly sysId: string;
  readonly className: string;
  readonly name: string;
  readonly scope: string;
  readonly table: string | null;
  readonly active: boolean;
  readonly updatedOn: string;
  readonly details: Readonly<Record<string, string>>;
  // Scripts and other long fields, and child rows, beside the record file.
  readonly files: readonly string[];
  readonly usedBy: readonly UsedBy[];
  readonly usedByMore: boolean;
  readonly next: readonly NextCall[];
}

async function locate(deps: KnowledgeDependencies, target: string): Promise<IndexedRecord> {
  const base = recordBaseOfPath(target.endsWith(".yaml") ? target : `${target}.yaml`);
  const [byPath] = base === null ? [] : await deps.store.byBases([base]);
  const record = byPath ?? (await deps.store.bySysId(target));
  if (record === null) {
    throw new RecordNotFoundError(target);
  }
  return record;
}

// Who refers to this record: its sys_id anywhere, and for script includes their name in code
// as a whole word. One pass over the files.
async function usedBy(deps: KnowledgeDependencies, record: IndexedRecord) {
  const needles = [
    record.sysId,
    ...(record.className === "sys_script_include" && record.name !== "" ? [record.name] : []),
  ];
  const limit = USED_BY_LIMIT * 4;
  // The word index names the candidate records; their files give the exact lines.
  const candidates = (await deps.store.containing(needles, limit + 1)).filter(
    (base) => base !== record.base,
  );
  const hits =
    candidates.length === 0
      ? []
      : await deps.files.grep(needles, {
          limit,
          wholeWords: true,
          bases: candidates.slice(0, limit),
        });
  const own = `${record.base}.`;
  const elsewhere = hits.filter((hit) => !hit.path.startsWith(own));
  const records = new Map(
    (await deps.store.byBases([...new Set(elsewhere.map((hit) => baseOfFile(hit.path)))])).map(
      (r) => [r.base, r],
    ),
  );
  const seen = new Set<string>();
  const result: UsedBy[] = [];
  for (const hit of elsewhere) {
    const base = baseOfFile(hit.path);
    const owner = records.get(base);
    if (owner !== undefined && !seen.has(base)) {
      seen.add(base);
      result.push({
        path: `${base}.yaml`,
        name: owner.name,
        className: owner.className,
        line: hit.line,
        text: hit.text,
      });
    }
  }
  return {
    usedBy: result.slice(0, USED_BY_LIMIT),
    more: candidates.length > limit || result.length > USED_BY_LIMIT,
  };
}

// One record, by its path or sys_id: what it is, its files, and what refers to it.
export async function describeRecord(
  deps: KnowledgeDependencies,
  target: string,
): Promise<RecordDescription> {
  const record = await locate(deps, target);
  const files = (await deps.files.filesOf(record.base)).filter(
    (file) => file !== `${record.base}.yaml`,
  );
  const references = await usedBy(deps, record);
  const next: NextCall[] =
    record.table === null ? [] : [{ tool: "describe", args: { target: record.table } }];
  return {
    ...freshness(deps),
    path: `${record.base}.yaml`,
    sysId: record.sysId,
    className: record.className,
    name: record.name,
    scope: record.scope,
    table: record.table,
    active: record.active,
    updatedOn: record.updatedOn,
    details: record.fields,
    files,
    usedBy: references.usedBy,
    usedByMore: references.more,
    next,
  };
}
