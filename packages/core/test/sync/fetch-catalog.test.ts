import { describe, expect, it } from "bun:test";
import {
  type ConnectionStats,
  fetchCatalog,
  type InstanceReader,
  KeysetPager,
  type Row,
  type TableQuery,
} from "@snagentic/core";

const LIVE = new AbortController().signal;
const STATS: ConnectionStats = {
  requests: 0,
  retries: 0,
  semaphoreWaitMs: 0,
  transactionIds: [],
  concurrencyLimit: 2,
  peakConcurrency: 2,
  requestMs: 0,
};

// Serves snapshot listings: honors `sys_id>` cursors and the limit, and records queries.
function tables(data: Record<string, Row[]>): InstanceReader & { queries: TableQuery[] } {
  const queries: TableQuery[] = [];
  return {
    queries,
    query: async (query) => {
      queries.push(query);
      const after = /sys_id>([^^]+)/.exec(query.query)?.[1] ?? "";
      return (data[query.table] ?? [])
        .filter((row) => (row["sys_id"] ?? "") > after)
        .sort((a, b) => ((a["sys_id"] ?? "") < (b["sys_id"] ?? "") ? -1 : 1))
        .slice(0, query.limit);
    },
    stats: () => STATS,
  };
}

const DATA = {
  sys_db_object: [
    { sys_id: "01", name: "sys_metadata", super_class: "" },
    { sys_id: "02", name: "sys_script", super_class: "01" },
    { sys_id: "03", name: "x_rule", super_class: "02" },
    { sys_id: "04", name: "orphan", super_class: "99" },
  ],
  sys_scope: [
    { sys_id: "s1", scope: "x_acme" },
    { sys_id: "global", scope: "global" },
  ],
  sys_dictionary: [
    { sys_id: "d1", name: "sys_script", element: "script", internal_type: "script_server" },
    { sys_id: "d2", name: "x_rule", element: "u_secret", internal_type: "password2" },
    { sys_id: "d3", name: "x_rule", element: "u_page", internal_type: "html" },
  ],
};

describe("fetchCatalog", () => {
  it("builds the class hierarchy, scopes and relevant field types", async () => {
    const reader = tables(DATA);
    const catalog = await fetchCatalog(new KeysetPager(reader), LIVE);
    expect(catalog).toEqual({
      parents: {
        sys_metadata: null,
        sys_script: "sys_metadata",
        x_rule: "sys_script",
        orphan: null,
      },
      scopes: { s1: "x_acme", global: "global" },
      typedFields: {
        sys_script: { script: "script_server" },
        x_rule: { u_secret: "password2", u_page: "html" },
      },
    });
  });

  it("asks the dictionary only for field types that decide files or secrets", async () => {
    const reader = tables(DATA);
    await fetchCatalog(new KeysetPager(reader), LIVE);
    const dictionary = reader.queries.find((query) => query.table === "sys_dictionary");
    expect(dictionary?.query).toStartWith("internal_typeINscript,script_plain,");
    expect(dictionary?.query).toContain("password2,encrypted_text");
    expect(dictionary?.fields).toEqual(["sys_id", "name", "element", "internal_type"]);
  });

  it("reports progress for each part of the catalog", async () => {
    const messages: string[] = [];
    await fetchCatalog(new KeysetPager(tables(DATA)), LIVE, (event) =>
      messages.push(event.message),
    );
    expect(messages).toEqual(["catalog: classes", "catalog: scopes", "catalog: field types"]);
  });
});
