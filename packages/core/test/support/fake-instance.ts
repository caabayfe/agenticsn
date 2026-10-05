import {
  AccessDeniedError,
  type ConnectionStats,
  type InstanceReader,
  type Row,
  type TableFingerprint,
  type TableName,
  type TableQuery,
  type TableStatistics,
} from "@snagentic/core";

const STATS: ConnectionStats = {
  requests: 0,
  retries: 0,
  semaphoreWaitMs: 0,
  transactionIds: [],
  concurrencyLimit: 2,
  peakConcurrency: 2,
  requestMs: 0,
};

type Term = (row: Row) => boolean;

// field>=value, field>value, field=value, fieldINa,b
function term(text: string): Term {
  const match = /^([a-z0-9_]+?)(>=|>|=|IN)(.*)$/.exec(text);
  if (match === null) {
    throw new Error(`the fake instance does not understand "${text}"`);
  }
  const [, field = "", operator, value = ""] = match;
  const read = (row: Row) => row[field] ?? "";
  switch (operator) {
    case ">=":
      return (row) => read(row) >= value;
    case ">":
      return (row) => read(row) > value;
    case "=":
      return (row) => read(row) === value;
    default: {
      const values = new Set(value.split(","));
      return (row) => values.has(read(row));
    }
  }
}

// Evaluates the encoded queries snagentic sends: ^-joined terms, ^NQ groups, ORDERBY terms.
export function evaluate(rows: readonly Row[], query: string, limit: number): Row[] {
  const order: string[] = [];
  const groups = query.split("^NQ").map((group) =>
    group.split("^").flatMap((text): Term[] => {
      if (text.startsWith("ORDERBY")) {
        order.push(text.slice("ORDERBY".length));
        return [];
      }
      return text === "" ? [] : [term(text)];
    }),
  );
  const compare = (a: Row, b: Row) => {
    for (const field of order) {
      const [x, y] = [a[field] ?? "", b[field] ?? ""];
      if (x !== y) {
        return x < y ? -1 : 1;
      }
    }
    return 0;
  };
  return rows
    .filter((row) => groups.some((terms) => terms.every((matches) => matches(row))))
    .sort(compare)
    .slice(0, limit);
}

// An in-memory instance. Rows of metadata classes are stored under their class and also
// answer queries on sys_metadata, as the real instance does.
export function fakeInstance(tables: Record<string, Row[]>, denied: readonly string[] = []) {
  const queries: TableQuery[] = [];
  const fingerprints: string[] = [];
  const rowsOf = (table: string): Row[] =>
    table === "sys_metadata"
      ? Object.values(tables).flatMap((rows) => rows.filter((row) => row["sys_class_name"]))
      : (tables[table] ?? []);
  const reader: InstanceReader & TableStatistics = {
    query: async (query) => {
      queries.push(query);
      if (denied.includes(query.table)) {
        throw new AccessDeniedError(`table ${query.table}`, "Insufficient rights");
      }
      return evaluate(rowsOf(query.table), query.query, query.limit);
    },
    fingerprint: async (table: TableName): Promise<TableFingerprint> => {
      fingerprints.push(table);
      if (denied.includes(table)) {
        throw new AccessDeniedError(`statistics of ${table}`, "Insufficient rights");
      }
      const rows = rowsOf(table);
      const latest = rows
        .map((row) => row["sys_updated_on"] ?? "")
        .sort()
        .at(-1);
      return { count: rows.length, maxUpdatedOn: latest || null };
    },
    countBy: async (table: TableName, field: string) => {
      const counts = new Map<string, number>();
      for (const row of rowsOf(table)) {
        const value = row[field] ?? "";
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return counts;
    },
    stats: () => STATS,
  };
  return { reader, queries, fingerprints, tables };
}
