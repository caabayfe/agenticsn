import { describe, expect, it } from "bun:test";
import type { Row } from "@snagentic/core";
import { BEFORE, pulledInstance, SECTION, sid } from "../support/incremental-fixture";

const rule = (n: number): Row => ({
  sys_id: sid(n),
  sys_class_name: "sys_script",
  name: `Rule ${n}`,
  sys_scope: "global",
  sys_updated_on: BEFORE,
});

// Real sys_ids spread evenly over their first characters.
const spread = (i: number): Row => ({
  ...rule(0),
  sys_id: `${(Math.imul(i + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, "0")}${"0".repeat(24)}`,
  name: `Spread ${i}`,
});

describe("pull --verify", () => {
  it("compares one count per scope and lists nothing when the mirror agrees", async () => {
    const { incremental } = await pulledInstance();
    const { summary, queries, counted } = await incremental({ verify: true });
    expect(summary.verification).toMatchObject({
      scopes: 1,
      scopesDiffering: 0,
      recovered: 0,
      removed: 0,
    });
    expect(queries.some((query) => String(query.table) === "sys_metadata")).toBe(false);
    expect(counted[0]).toStartWith("sys_metadata by sys_scope");
  });

  it("leaves classes a pull never mirrors, such as credentials, out of the counts", async () => {
    const { incremental } = await pulledInstance();
    const { counted } = await incremental({ verify: true });
    expect(counted[0]).toBe("sys_metadata by sys_scope where sys_class_nameNOT INsys_cred");
  });

  it("removes a record that vanished without a deletion record", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_script"] = tables["sys_script"]?.slice(0, 1) ?? [];
    const { summary } = await incremental({ verify: true });
    expect(summary.verification).toMatchObject({ scopesDiffering: 1, removed: 1 });
    expect(files.has(`global/sys_script/two--${sid(2)}.yaml`)).toBe(false);
  });

  it("recovers a record whose timestamp no change feed reaches", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_script"]?.push(rule(9));
    const { summary } = await incremental({ verify: true });
    expect(summary.records).toBe(0);
    expect(summary.verification).toMatchObject({ recovered: 1 });
    expect(files.has(`global/sys_script/rule-9--${sid(9)}.yaml`)).toBe(true);
  });

  it("splits a large scope by sys_id prefix and lists only the part that differs", async () => {
    const { incremental, tables, files } = await pulledInstance((data) => {
      data["sys_script"]?.push(...Array.from({ length: 5100 }, (_, i) => spread(i)));
    });
    const gone = spread(7)["sys_id"] ?? "";
    tables["sys_script"] = tables["sys_script"]?.filter((row) => row["sys_id"] !== gone) ?? [];
    const { summary, queries } = await incremental({ verify: true });
    expect(summary.verification).toMatchObject({ removed: 1, unverifiable: 0 });
    expect(summary.verification?.countRequests).toBeGreaterThan(16);
    const listings = queries.filter(
      (query) => String(query.table) === "sys_metadata" && query.query.startsWith("sys_scope"),
    );
    expect(listings.every((query) => query.query.includes("sys_idSTARTSWITH"))).toBe(true);
    expect(summary.verification?.listedRows).toBeLessThan(1000);
    expect([...files.keys()].some((path) => path.includes(gone))).toBe(false);
  });

  it("moves a child row that changed owner without a new timestamp", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_ui_element"] = (tables["sys_ui_element"] ?? []).map((row) =>
      row["sys_id"] === "e2" ? { ...row, sys_ui_section: sid(3) } : row,
    );
    await incremental({ verify: true });
    expect(files.get(`${SECTION}.children.sys_ui_element.yaml`)).toEqual([
      expect.objectContaining({ sys_id: "e1" }),
    ]);
    expect(files.get(`global/sys_hub_flow/flow--${sid(3)}.children.sys_ui_element.yaml`)).toEqual([
      expect.objectContaining({ sys_id: "e2" }),
    ]);
  });
});
