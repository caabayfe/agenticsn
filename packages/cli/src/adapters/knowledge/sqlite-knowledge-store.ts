import { Database } from "bun:sqlite";
import type {
  IndexedRecord,
  IndexMarker,
  KnowledgeStore,
  Phase,
  SearchQuery,
} from "@snagentic/core";

// Bump when the schema changes: an index with another version is dropped and rebuilt.
const SCHEMA_VERSION = 1;

const SCHEMA = `
create table records (
  base text primary key, sys_id text not null, class text not null, scope text not null,
  name text not null, tbl text, phase text, ord real not null, active integer not null,
  updated_on text not null, fields text not null);
create index records_tbl on records (tbl);
create index records_sys_id on records (sys_id);
create index records_class on records (class);
create virtual table records_fts using fts5 (
  name, class, tbl, scope, content = 'records', content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");
create trigger records_ai after insert on records begin
  insert into records_fts (rowid, name, class, tbl, scope) values (new.rowid, new.name, new.class, new.tbl, new.scope);
end;
create trigger records_ad after delete on records begin
  insert into records_fts (records_fts, rowid, name, class, tbl, scope) values ('delete', old.rowid, old.name, old.class, old.tbl, old.scope);
end;
create table marker (id integer primary key check (id = 1), commit_id text not null, dirty text not null);
`;

interface Row {
  base: string;
  sys_id: string;
  class: string;
  scope: string;
  name: string;
  tbl: string | null;
  phase: string | null;
  ord: number;
  active: number;
  updated_on: string;
  fields: string;
}

const toRecord = (row: Row): IndexedRecord => ({
  base: row.base,
  sysId: row.sys_id,
  className: row.class,
  scope: row.scope,
  name: row.name,
  table: row.tbl,
  phase: row.phase as Phase | null,
  order: row.ord,
  active: row.active === 1,
  updatedOn: row.updated_on,
  fields: JSON.parse(row.fields) as Record<string, string>,
});

// Words of a search, each matched as a prefix, all required. Quoting keeps FTS5 syntax
// characters in the user's text from being read as operators.
function matchExpression(text: string): string {
  return text
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .map((word) => `"${word.replaceAll('"', '""')}"*`)
    .join(" ");
}

export class SqliteKnowledgeStore implements KnowledgeStore {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run("pragma journal_mode = wal");
    const version =
      this.db.query<{ user_version: number }, []>("pragma user_version").get()?.user_version ?? 0;
    if (version !== SCHEMA_VERSION) {
      for (const name of ["records_fts", "records", "marker"]) {
        this.db.run(`drop table if exists ${name}`);
      }
      this.db.run(SCHEMA);
      this.db.run(`pragma user_version = ${SCHEMA_VERSION}`);
    }
  }

  async marker(): Promise<IndexMarker | null> {
    const row = this.db
      .query<{ commit_id: string; dirty: string }, []>(
        "select commit_id, dirty from marker where id = 1",
      )
      .get();
    return row === null
      ? null
      : { commit: row.commit_id, dirty: JSON.parse(row.dirty) as string[] };
  }

  async apply(
    upserts: readonly IndexedRecord[],
    removed: readonly string[],
    marker: IndexMarker | null,
  ): Promise<void> {
    const remove = this.db.prepare("delete from records where base = ?");
    const insert = this.db.prepare(
      "insert into records (base, sys_id, class, scope, name, tbl, phase, ord, active, updated_on, fields) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.db.transaction(() => {
      for (const base of [...removed, ...upserts.map((record) => record.base)]) {
        remove.run(base);
      }
      for (const r of upserts) {
        insert.run(
          r.base,
          r.sysId,
          r.className,
          r.scope,
          r.name,
          r.table,
          r.phase,
          r.order,
          r.active ? 1 : 0,
          r.updatedOn,
          JSON.stringify(r.fields),
        );
      }
      if (marker !== null) {
        this.db.run("insert or replace into marker (id, commit_id, dirty) values (1, ?, ?)", [
          marker.commit,
          JSON.stringify(marker.dirty),
        ]);
      }
    })();
  }

  async search(query: SearchQuery): Promise<{ records: IndexedRecord[]; total: number }> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const words = matchExpression(query.text ?? "");
    if (words !== "") {
      where.push("records_fts match ?");
      params.push(words);
    }
    for (const [column, value] of [
      ["r.class", query.className],
      ["r.scope", query.scope],
      ["r.tbl", query.table],
    ] as const) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        params.push(value);
      }
    }
    const from =
      words === "" ? "records r" : "records_fts join records r on r.rowid = records_fts.rowid";
    const filter = where.length === 0 ? "" : `where ${where.join(" and ")}`;
    const order = words === "" ? "order by r.name, r.base" : "order by bm25(records_fts), r.name";
    const total =
      this.db
        .query<{ n: number }, (string | number)[]>(`select count(*) as n from ${from} ${filter}`)
        .get(...params)?.n ?? 0;
    const rows = this.db
      .query<Row, (string | number)[]>(`select r.* from ${from} ${filter} ${order} limit ?`)
      .all(...params, query.limit);
    return { records: rows.map(toRecord), total };
  }

  async onTables(tables: readonly string[]): Promise<IndexedRecord[]> {
    const marks = tables.map(() => "?").join(", ");
    return this.db
      .query<Row, string[]>(`select * from records where tbl in (${marks})`)
      .all(...tables)
      .map(toRecord);
  }

  async byBases(bases: readonly string[]): Promise<IndexedRecord[]> {
    const marks = bases.map(() => "?").join(", ");
    return bases.length === 0
      ? []
      : this.db
          .query<Row, string[]>(`select * from records where base in (${marks})`)
          .all(...bases)
          .map(toRecord);
  }

  async bySysId(sysId: string): Promise<IndexedRecord | null> {
    const row = this.db
      .query<Row, [string]>("select * from records where sys_id = ? limit 1")
      .get(sysId);
    return row === null ? null : toRecord(row);
  }

  async count(): Promise<number> {
    return this.db.query<{ n: number }, []>("select count(*) as n from records").get()?.n ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
