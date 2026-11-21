import { describe, expect, it } from "bun:test";
import {
  aggregateLiveTable,
  createProfile,
  getLiveRecord,
  type InstanceKind,
  InstanceName,
  type LiveQueryEntry,
  queryLiveSchema,
  queryLiveTable,
  type Row,
  TableName,
  type TableQuery,
} from "../../src/index";
import { fakeInstance } from "../support/fake-instance";

const id = (n: number) => n.toString(16).padStart(32, "0");
const signal = () => new AbortController().signal;
const NOW = new Date("2026-11-21T10:00:00.000Z");

function fixture(kind: InstanceKind, options: { enabled?: boolean; failingLog?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    sys_db_object: [{ sys_id: id(1), name: "incident", super_class: "" }],
    sys_dictionary: ["number", "active", "sys_updated_on", "short_description"].map(
      (element, i) => ({
        sys_id: id(10 + i),
        name: "incident",
        element,
        internal_type: "string",
        reference: "",
        unique: element === "number" ? "true" : "false",
      }),
    ),
    incident: [{ sys_id: id(100), number: "INC0000042", active: "true" }],
  };
  const instance = fakeInstance(tables);
  const requests: TableQuery[] = [];
  const entries: LiveQueryEntry[] = [];
  const base = createProfile({
    name: InstanceName.parse("acme"),
    url: "dev1",
    username: "sam.reader",
    kind,
    acknowledgeReadOnly: kind !== "development",
  });
  const access = {
    profile:
      options.enabled === undefined ? base : { ...base, liveQueries: { enabled: options.enabled } },
    reader: {
      ...instance.reader,
      query: async (query: TableQuery, s: AbortSignal) => {
        requests.push(query);
        return instance.reader.query(query, s);
      },
    },
    log: {
      path: ".snagentic/acme/live-queries.jsonl",
      append: async (entry: LiveQueryEntry) => {
        if (options.failingLog === true) throw new Error("disk full");
        entries.push(entry);
      },
    },
    clock: () => NOW,
  };
  return { access, requests, entries };
}

const table = TableName.parse("incident");
const byNumber = { table, fields: ["number"], query: "number=INC0000042^active=true", limit: 5 };

describe("live queries", () => {
  for (const kind of ["production", "test"] as const) {
    it(`refuses a live query on a ${kind} instance unless instance.yaml enables it`, async () => {
      for (const enabled of [undefined, false]) {
        const off = fixture(kind, enabled === undefined ? {} : { enabled });
        const refusals = [
          queryLiveTable(off.access, byNumber, signal()),
          getLiveRecord(off.access, { table, sysId: id(100), fields: ["number"] }, signal()),
          aggregateLiveTable(off.access, { table, query: byNumber.query }, signal()),
          queryLiveSchema(off.access, table, signal()),
        ];
        for (const refusal of refusals) {
          const error = await refusal.catch((caught: unknown) => caught);
          expect(error).toMatchObject({ code: "live-queries-disabled", category: "not-permitted" });
          expect(error).toHaveProperty(
            "hint",
            expect.stringContaining("instances/acme/instance.yaml"),
          );
          expect(error).toHaveProperty("hint", expect.stringContaining("live_queries"));
        }
        expect(off.requests).toHaveLength(0);
        expect(off.entries).toHaveLength(0);
      }
      const on = fixture(kind, { enabled: true });
      const result = await queryLiveTable(on.access, byNumber, signal());
      expect(result.rows).toEqual([{ number: "INC0000042" }]);
    });
  }

  it("runs live queries on a development instance as before", async () => {
    for (const options of [{}, { enabled: false }]) {
      const dev = fixture("development", options);
      const result = await queryLiveTable(dev.access, byNumber, signal());
      expect(result.rows).toEqual([{ number: "INC0000042" }]);
      expect(dev.entries).toHaveLength(1);
    }
  });

  it("records each live query without its filter values", async () => {
    const { access, entries } = fixture("production", { enabled: true });
    await queryLiveTable(access, byNumber, signal());
    await getLiveRecord(access, { table, sysId: id(100), fields: ["number"] }, signal());
    await aggregateLiveTable(
      access,
      { table, query: `sys_idIN${id(100)},${id(101)}^numberSTARTSWITHINC` },
      signal(),
    );
    await queryLiveSchema(access, table, signal());
    const common = {
      at: "2026-11-21T10:00:00.000Z",
      instance: "acme",
      kind: "production",
      user: "sam.reader",
      table: "incident",
    } as const;
    expect(entries).toEqual([
      {
        ...common,
        operation: "table",
        filter: [
          { field: "number", operator: "=" },
          { field: "active", operator: "=" },
        ],
      },
      { ...common, operation: "record", filter: [{ field: "sys_id", operator: "=" }] },
      {
        ...common,
        operation: "aggregate",
        filter: [
          { field: "sys_id", operator: "IN" },
          { field: "number", operator: "STARTSWITH" },
        ],
      },
      { ...common, operation: "schema", filter: [] },
    ]);
    const text = JSON.stringify(entries);
    for (const secret of ["INC0000042", id(100), id(101), "true"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses a live query whose log entry cannot be written", async () => {
    const { access, requests } = fixture("production", { enabled: true, failingLog: true });
    await expect(queryLiveTable(access, byNumber, signal())).rejects.toMatchObject({
      code: "live-query-log-unavailable",
      hint: expect.stringContaining(".snagentic/acme/live-queries.jsonl"),
    });
    expect(requests).toHaveLength(0);
  });

  it("records nothing for a query refused before its first request", async () => {
    const { access, entries, requests } = fixture("development");
    await expect(
      queryLiveTable(access, { ...byNumber, table: TableName.parse("sys_user_token") }, signal()),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      queryLiveTable(access, { ...byNumber, query: "numberLIKEINC" }, signal()),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(entries).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});
