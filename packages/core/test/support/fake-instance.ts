import {
  AccessDeniedError,
  type ConnectionStats,
  type InstanceReader,
  type PluginActivator,
  type Row,
  type ServerCostReader,
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

// field>=value, field>value, field=value, fieldINa,b, fieldNOT INa,b, fieldSTARTSWITHv,
// fieldISEMPTY
function term(text: string): Term {
  const match = /^([a-z0-9_.]+?)(>=|>|=|NOT IN|IN|STARTSWITH|ISNOTEMPTY|ISEMPTY)(.*)$/.exec(text);
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
    case "ISNOTEMPTY":
      return (row) => read(row) !== "";
    case "ISEMPTY":
      return (row) => read(row) === "";
    case "STARTSWITH":
      return (row) => read(row).toLowerCase().startsWith(value.toLowerCase());
    case "NOT IN": {
      const values = new Set(value.split(","));
      return (row) => !values.has(read(row));
    }
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
  // Plugin activations started, by plugin id. Activations succeed at once unless told otherwise.
  const activations: string[] = [];
  // Aggregate requests other than fingerprints, as their queries.
  const counted: string[] = [];
  const rowsOf = (table: string): Row[] =>
    table === "sys_metadata"
      ? Object.values(tables).flatMap((rows) => rows.filter((row) => row["sys_class_name"]))
      : (tables[table] ?? []);
  const reader: InstanceReader & TableStatistics & ServerCostReader & { plugins: PluginActivator } =
    {
      query: async (query) => {
        queries.push(query);
        if (denied.includes(query.table)) {
          throw new AccessDeniedError(`table ${query.table}`, "Insufficient rights");
        }
        // ACLs hide rows from listings, not from aggregates.
        const visible = rowsOf(query.table).filter((row) => row["__hidden"] !== "true");
        return evaluate(visible, query.query, query.limit);
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
      count: async (table: TableName, query: string) => {
        counted.push(query);
        return evaluate(rowsOf(table), query, Number.MAX_SAFE_INTEGER).length;
      },
      countBy: async (table: TableName, field: string, _signal?: AbortSignal, query = "") => {
        counted.push(`${table} by ${field}${query === "" ? "" : ` where ${query}`}`);
        const counts = new Map<string, number>();
        for (const row of evaluate(rowsOf(table), query, Number.MAX_SAFE_INTEGER)) {
          const value = row[field] ?? "";
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return counts;
      },
      serverCost: async () => ({
        transactions: queries.length,
        responseMs: 100 * queries.length,
        maxResponseMs: 100,
        sqlMs: 40 * queries.length,
        sqlQueries: 5 * queries.length,
        cpuMs: 10 * queries.length,
        businessRuleMs: 0,
        aclMs: queries.length,
        semaphoreWaitMs: 0,
      }),
      stats: () => STATS,
      plugins: {
        activate: async (pluginId: string) => {
          activations.push(pluginId);
          return {
            progressId: `progress-${pluginId}`,
            status: "running" as const,
            percent: 0,
            message: "",
            error: "",
          };
        },
        progress: async (progressId: string) => ({
          progressId,
          status: "successful" as const,
          percent: 100,
          message: "",
          error: "",
        }),
      },
    };
  return { reader, queries, fingerprints, counted, tables, activations };
}
