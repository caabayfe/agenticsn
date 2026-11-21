import { describe, expect, it } from "bun:test";
import { type Row, TableName, type TableQuery } from "../../src/index";
import {
  aggregateLiveTable,
  getLiveRecord,
  queryLiveTable,
} from "../../src/investigation/application/live-reads";
import { readLiveSchema } from "../../src/investigation/application/live-schema";
import { fakeInstance } from "../support/fake-instance";

const id = (n: number) => n.toString(16).padStart(32, "0");
function fixture(extra: Record<string, Row[]> = {}) {
  const tables = {
    sys_db_object: [
      { sys_id: id(1), name: "incident", super_class: "" },
      { sys_id: id(2), name: "sys_properties", super_class: "" },
    ],
    sys_dictionary: [
      ...["number", "active", "sys_updated_on", "short_description", "password"].map(
        (element, i) => ({
          sys_id: id(10 + i),
          name: "incident",
          element,
          internal_type: element === "password" ? "password2" : "string",
          reference: "",
          unique: element === "number" ? "true" : "false",
        }),
      ),
      ...["name", "value", "type", "is_private"].map((element, i) => ({
        sys_id: id(20 + i),
        name: "sys_properties",
        element,
        internal_type: "string",
        reference: "",
        unique: element === "name" ? "true" : "false",
      })),
    ],
    incident: Array.from({ length: 5 }, (_, n) => ({
      sys_id: id(100 + n),
      number: `INC${n}`,
      active: "true",
      password: "synthetic-password",
    })),
    sys_properties: [
      {
        sys_id: id(200),
        name: "test.password",
        type: "password2",
        is_private: "false",
        value: "synthetic-secret",
      },
    ],
    ...extra,
  };
  const instance = fakeInstance(tables);
  const queries: TableQuery[] = [];
  const reader = {
    ...instance.reader,
    query: async (query: TableQuery, signal: AbortSignal) => {
      queries.push(query);
      return instance.reader.query(query, signal);
    },
  };
  return { reader, queries, tables };
}
const signal = () => new AbortController().signal;
const request = {
  table: TableName.parse("incident"),
  fields: ["number", "password"],
  query: `sys_idIN${[100, 101, 102, 103, 104].map(id).join(",")}`,
  limit: 2,
};

describe("bounded live investigation", () => {
  it("pages by keyset, never by offset, and redacts typed secrets before returning rows", async () => {
    const { reader, queries } = fixture();
    const first = await queryLiveTable(reader, request, signal());
    expect(first.rows.map((row) => row["number"])).toEqual(["INC0", "INC1"]);
    expect(first.rows[0]?.["password"]).toBe("[redacted]");
    expect(first.nextCursor).not.toBeNull();
    const second = await queryLiveTable(
      reader,
      { ...request, cursor: first.nextCursor ?? undefined },
      signal(),
    );
    expect(second.rows.map((row) => row["number"])).toEqual(["INC2", "INC3"]);
    expect(
      queries
        .filter((query) => query.table === "incident")
        .every((query) => query.query.includes("ORDERBYsys_id")),
    ).toBe(true);
  });

  it("validates unknown fields, executable expressions, unbounded predicates and cursors before data reads", async () => {
    for (const change of [
      { query: "typo=true" },
      { fields: ["missing"] },
      { query: "sys_updated_on>=javascript:gs.daysAgoStart(7)" },
      { query: "active=true" },
      { cursor: "not-a-cursor" },
      { limit: 101 },
    ]) {
      const { reader, queries } = fixture();
      await expect(
        queryLiveTable(reader, { ...request, ...change }, signal()),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(queries.filter((query) => query.table === "incident")).toHaveLength(0);
    }
  });

  it("does not let NQ branches escape the selective filter or keyset boundary", async () => {
    const { reader } = fixture();
    await expect(
      queryLiveTable(reader, { ...request, query: `sys_id=${id(100)}^NQactive=true` }, signal()),
    ).rejects.toThrow();
    const query = `sys_id=${id(100)}^NQsys_id=${id(103)}`;
    const first = await queryLiveTable(reader, { ...request, query, limit: 1 }, signal());
    const second = await queryLiveTable(
      reader,
      { ...request, query, limit: 1, cursor: first.nextCursor ?? undefined },
      signal(),
    );
    expect(first.rows[0]?.["number"]).toBe("INC0");
    expect(second.rows[0]?.["number"]).toBe("INC3");
    await expect(
      queryLiveTable(
        reader,
        { ...request, query, cursor: first.nextCursor ?? undefined },
        signal(),
      ),
    ).rejects.toThrow();
  });

  it("does not accept a cursor from a different instance or identity", async () => {
    const { reader } = fixture();
    const first = await queryLiveTable(
      reader,
      { ...request, source: "instance-a:user-a" },
      signal(),
    );
    await expect(
      queryLiveTable(
        reader,
        { ...request, source: "instance-b:user-a", cursor: first.nextCursor ?? undefined },
        signal(),
      ),
    ).rejects.toThrow("cursor");
  });

  it("masks property values even when callers request only name and value", async () => {
    const { reader } = fixture();
    const result = await getLiveRecord(
      reader,
      { table: TableName.parse("sys_properties"), sysId: id(200), fields: ["name", "value"] },
      signal(),
    );
    expect(result.record?.["value"]).toBe("[redacted]");
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it("rejects credential tables before issuing requests", async () => {
    const { reader, queries } = fixture();
    await expect(
      readLiveSchema(reader, TableName.parse("discovery_credentials"), signal()),
    ).rejects.toThrow();
    expect(queries).toHaveLength(0);
  });

  it("bounds long text while preserving a valid structured result", async () => {
    const { reader } = fixture({
      incident: [{ sys_id: id(100), short_description: "x".repeat(20000) }],
    });
    const result = await queryLiveTable(
      reader,
      { ...request, fields: ["short_description"] },
      signal(),
    );
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(100000);
    expect(result.rows[0]?.["short_description"]).toEndWith("[truncated]");
  });

  it("validates reference targets and masks dotted property values", async () => {
    const base = fixture();
    base.tables.sys_dictionary.push({
      sys_id: id(99),
      name: "incident",
      element: "property",
      internal_type: "reference",
      reference: "sys_properties",
      unique: "false",
    });
    const extra = {
      reader: {
        ...base.reader,
        query: async (query: TableQuery, abort: AbortSignal) => {
          const rows = await base.reader.query(query, abort);
          if (query.table === "incident")
            return rows.map((row) => ({ ...row, "property.value": "synthetic-dot-secret" }));
          return rows;
        },
      },
    };
    const result = await queryLiveTable(
      extra.reader,
      { ...request, fields: ["property.value"] },
      signal(),
    );
    expect(JSON.stringify(result)).not.toContain("synthetic-dot-secret");
    expect(result.rows[0]?.["property.value"]).toBe("[redacted]");
    await expect(
      queryLiveTable(base.reader, { ...request, fields: ["number.missing"] }, signal()),
    ).rejects.toThrow();
  });

  it("returns complete inherited schema or an explicit error, including more than 1000 fields", async () => {
    const fields = Array.from({ length: 1001 }, (_, i) => ({
      sys_id: id(i + 1000),
      name: "incident",
      element: `u_${i}`,
      internal_type: "string",
      unique: "false",
      reference: "",
    }));
    const { reader } = fixture({ sys_dictionary: fields });
    const result = await readLiveSchema(reader, TableName.parse("incident"), signal());
    expect(result.fields).toHaveLength(1002);
    expect(result.complete).toBe(true);
  });

  it("counts matching records and bounded groups without exposing raw records", async () => {
    const { reader } = fixture();
    const result = await aggregateLiveTable(
      reader,
      { table: request.table, query: request.query, groupBy: "active" },
      signal(),
    );
    expect(result.count).toBe(5);
    expect(result.groups).toEqual([{ value: "true", count: 5 }]);
  });

  it("continues after ACL-shortened pages and reports missing records as credential-limited", async () => {
    const { reader } = fixture();
    let first = true;
    const acl = {
      ...reader,
      query: async (query: TableQuery, abort: AbortSignal) => {
        const rows = await reader.query(query, abort);
        if (query.table !== "incident" || !first) return rows;
        first = false;
        return rows.slice(0, 1);
      },
    };
    const result = await queryLiveTable(acl, request, signal());
    expect(result.rows.map((row) => row["number"])).toEqual(["INC0", "INC1"]);
    const absent = await getLiveRecord(
      reader,
      { table: request.table, sysId: id(999), fields: ["number"] },
      signal(),
    );
    expect(absent.record).toBeNull();
    expect(absent.note).toContain("ACLs may hide");
  });

  it("refuses incomplete, cyclic and over-budget schema rather than claiming completeness", async () => {
    const partial = fixture({ sys_db_object: [{ sys_id: id(1), name: "incident" }] });
    await expect(readLiveSchema(partial.reader, request.table, signal())).rejects.toThrow();
    const cycle = fixture({
      sys_db_object: [{ sys_id: id(1), name: "incident", super_class: id(1) }],
    });
    await expect(readLiveSchema(cycle.reader, request.table, signal())).rejects.toThrow("cyclic");
    const huge = fixture({
      sys_dictionary: Array.from({ length: 4001 }, (_, n) => ({
        sys_id: id(n + 1000),
        name: "incident",
        element: `u_${n}`,
        internal_type: "string",
      })),
    });
    await expect(readLiveSchema(huge.reader, request.table, signal())).rejects.toThrow("budget");
  });

  it("refuses sensitive grouping and excessive group output", async () => {
    const { reader } = fixture();
    await expect(
      aggregateLiveTable(
        reader,
        { table: request.table, query: request.query, groupBy: "password" },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "masked-field" });
    const many = {
      ...reader,
      countBy: async () => new Map(Array.from({ length: 101 }, (_, n) => [`group-${n}`, 1])),
    };
    await expect(
      aggregateLiveTable(
        many,
        { table: request.table, query: request.query, groupBy: "number" },
        signal(),
      ),
    ).rejects.toThrow("100 groups");
    const big = {
      ...reader,
      countBy: async () =>
        new Map(Array.from({ length: 100 }, (_, n) => [`${n}-${"x".repeat(2000)}`, 1])),
    };
    await expect(
      aggregateLiveTable(
        big,
        { table: request.table, query: request.query, groupBy: "number" },
        signal(),
      ),
    ).rejects.toThrow("budget");
  });
});
