import { describe, expect, it } from "bun:test";
import { type Row, TableName, type TableQuery } from "../../src/index";
import {
  aggregateLiveTable,
  getLiveRecord,
  queryLiveTable,
} from "../../src/investigation/application/live-reads";
import { fakeInstance } from "../support/fake-instance";

const id = (n: number) => n.toString(16).padStart(32, "0");
const column = (n: number, name: string, element: string, type = "string", reference = "") => ({
  sys_id: id(n),
  name,
  element,
  internal_type: type,
  reference,
  unique: element === "number" || element === "name" ? "true" : "false",
});

function fixture() {
  const tables: Record<string, Row[]> = {
    sys_db_object: [
      { sys_id: id(1), name: "incident", super_class: "" },
      { sys_id: id(2), name: "sys_properties", super_class: "" },
    ],
    sys_dictionary: [
      column(10, "incident", "number"),
      column(11, "incident", "active"),
      column(12, "incident", "sys_updated_on"),
      column(13, "incident", "password", "password2"),
      column(14, "incident", "property", "reference", "sys_properties"),
      column(20, "sys_properties", "name"),
      column(21, "sys_properties", "value"),
      column(22, "sys_properties", "type"),
      column(23, "sys_properties", "is_private"),
    ],
    incident: [
      { sys_id: id(100), number: "INC0", active: "true", password: "synthetic-password" },
      { sys_id: id(101), number: "INC1", active: "true", password: "synthetic-password" },
    ],
    sys_properties: [
      { sys_id: id(200), name: "a.switch", type: "string", is_private: "false", value: "x" },
    ],
  };
  const instance = fakeInstance(tables);
  const data: TableQuery[] = [];
  const reader = {
    ...instance.reader,
    query: async (query: TableQuery, signal: AbortSignal) => {
      if (query.table === "incident" || query.table === "sys_properties") data.push(query);
      return instance.reader.query(query, signal);
    },
  };
  return { reader, data };
}

const signal = () => new AbortController().signal;
const anchor = `sys_idIN${id(100)},${id(101)}`;
const incident = { table: TableName.parse("incident"), fields: ["number"], limit: 10 };
const REFUSAL = { code: "masked-field", hint: expect.stringMatching(/select, sort or group/) };

async function expectRefused(query: string, table = incident.table, fields = incident.fields) {
  const { reader, data } = fixture();
  await expect(
    queryLiveTable(reader, { ...incident, table, fields, query }, signal()),
  ).rejects.toMatchObject(REFUSAL);
  expect(data).toHaveLength(0);
}

describe("fields whose values are masked cannot influence a live result", () => {
  it("refuses a filter on a field whose values are masked", async () => {
    await expectRefused(`${anchor}^passwordSTARTSWITHs`);
    await expectRefused(`${anchor}^passwordISNOTEMPTY`);
  });

  it("refuses a masked field in an OR branch", async () => {
    await expectRefused(`${anchor}^active=true^ORpassword=synthetic-password`);
  });

  it("refuses a masked field in an NQ branch", async () => {
    await expectRefused(`${anchor}^NQsys_id=${id(101)}^password>=s`);
  });

  it("refuses a masked field reached through a reference", async () => {
    await expectRefused(`${anchor}^property.valueSTARTSWITHx`);
  });

  it("refuses a filter on a value the redaction policy masks per record", async () => {
    await expectRefused(`sys_id=${id(200)}^valueSTARTSWITHx`, TableName.parse("sys_properties"), [
      "name",
    ]);
  });

  it("refuses an ordering term, masked or not", async () => {
    for (const order of ["ORDERBYpassword", "ORDERBYDESCpassword", "ORDERBYnumber"]) {
      const { reader, data } = fixture();
      await expect(
        queryLiveTable(reader, { ...incident, query: `${anchor}^${order}` }, signal()),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(data).toHaveLength(0);
    }
  });

  it("refuses to group by a field whose values are masked", async () => {
    const { reader } = fixture();
    await expect(
      aggregateLiveTable(
        reader,
        { table: incident.table, query: anchor, groupBy: "password" },
        signal(),
      ),
    ).rejects.toMatchObject(REFUSAL);
  });

  it("refuses to count with a filter on a masked field", async () => {
    const { reader } = fixture();
    await expect(
      aggregateLiveTable(
        reader,
        { table: incident.table, query: `${anchor}^password=x` },
        signal(),
      ),
    ).rejects.toMatchObject(REFUSAL);
  });

  it("names the field and says its values are masked", async () => {
    const { reader } = fixture();
    await expect(
      queryLiveTable(reader, { ...incident, query: `${anchor}^password=x` }, signal()),
    ).rejects.toThrow(/password.*masked/);
  });

  it("still selects by sys_id, unique fields and readable fields", async () => {
    const { reader } = fixture();
    const read = (query: string) => queryLiveTable(reader, { ...incident, query }, signal());
    expect((await read(`sys_id=${id(100)}`)).rows).toHaveLength(1);
    expect((await read("number=INC1")).rows[0]?.["number"]).toBe("INC1");
    expect((await read(`${anchor}^active=true`)).rows).toHaveLength(2);
    expect((await read(`${anchor}^NQnumberININC0,INC1`)).rows).toHaveLength(2);
    const record = await getLiveRecord(
      reader,
      { table: incident.table, sysId: id(101), fields: ["number", "password"] },
      signal(),
    );
    expect(record.record).toEqual({ number: "INC1", password: "[redacted]" });
  });

  it("still filters through a reference on a readable field and groups by one", async () => {
    const { reader } = fixture();
    await expect(
      queryLiveTable(reader, { ...incident, query: `${anchor}^property.nameISEMPTY` }, signal()),
    ).resolves.toMatchObject({ table: "incident" });
    const grouped = await aggregateLiveTable(
      reader,
      { table: incident.table, query: anchor, groupBy: "active" },
      signal(),
    );
    expect(grouped.groups).toEqual([{ value: "true", count: 2 }]);
  });
});
