import { describe, expect, it } from "bun:test";
import { pulledInstance, RULE, sid, touch } from "../support/incremental-fixture";

// A pull that could not store the changed rule (its own table hid it), then a later pull.
async function afterUnstoredPull() {
  const fixture = await pulledInstance();
  const row = fixture.tables["sys_script"]?.[0];
  touch(row, { script: "changed();", __hidden_in_class: "true" });
  const first = await fixture.incremental();
  fixture.state.saved.state = first.summary.next;
  const show = () => Object.assign(row ?? {}, { __hidden_in_class: "" });
  return { ...fixture, first, show };
}

const RECORDED = [{ table: "sys_script", sysId: sid(1) }];

describe("pull --verify: records an earlier pull could not store", () => {
  it("re-reads the records an earlier pull could not store when verifying", async () => {
    const { incremental, files, first: earlier, show } = await afterUnstoredPull();
    expect(earlier.summary.next.unstored).toEqual(RECORDED);
    show();
    const { summary, queries } = await incremental({ verify: true });
    expect(files.get(`${RULE}.script.js`)).toBe("changed();\n");
    expect(summary.unstored).toEqual({ count: 0, inMirror: 0, recovered: 1, records: [] });
    expect(summary.records).toBe(1);
    expect(summary.next.unstored).toBeUndefined();
    // By sys_id: where the record is now, then the record from its own table. Each listing is
    // its page and the empty page that ends it (ADR-0016).
    const first = (table: string) =>
      queries
        .filter((query) => String(query.table) === table)
        .map((query) => query.query.split("^")[0]);
    expect(first("sys_metadata")).toEqual([`sys_idIN${sid(1)}`, `sys_idIN${sid(1)}`]);
    expect(first("sys_script")).toEqual([`sys_idIN${sid(1)}`, `sys_idIN${sid(1)}`]);
    const located = queries.find((query) => String(query.table) === "sys_metadata");
    expect(located?.fields).toEqual(["sys_id", "sys_class_name", "sys_scope"]);
  });

  it("keeps reporting a record that is still not readable", async () => {
    const { incremental, files } = await afterUnstoredPull();
    const { summary } = await incremental({ verify: true });
    expect(files.get(`${RULE}.script.js`)).toBe("one();\n");
    expect(summary.unstored).toEqual({
      count: 1,
      inMirror: 1,
      recovered: 0,
      records: [{ table: "sys_script", sysId: sid(1), inMirror: true, reason: "hidden" }],
    });
    expect(summary.next.unstored).toEqual(RECORDED);
  });

  it("says so when the record's table refuses this user", async () => {
    const { incremental, deny } = await afterUnstoredPull();
    deny("sys_script");
    const { summary } = await incremental({ verify: true });
    expect(summary.unstored.records).toEqual([
      { table: "sys_script", sysId: sid(1), inMirror: true, reason: "table-unreadable" },
    ]);
    expect(summary.next.unstored).toEqual(RECORDED);
  });

  it("says the instance no longer lists a record it cannot tell deleted from hidden", async () => {
    const { incremental, tables } = await afterUnstoredPull();
    tables["sys_script"] = tables["sys_script"]?.slice(1) ?? [];
    // A user who is not the mirror's owner keeps what the instance does not list (ADR-0052).
    const { summary } = await incremental({ verify: true }, { absence: "keep" });
    expect(summary.unstored.records).toEqual([
      { table: "sys_script", sysId: sid(1), inMirror: true, reason: "not-listed" },
    ]);
    expect(summary.next.unstored).toEqual(RECORDED);
  });

  it("forgets a record the verification removed from the mirror", async () => {
    const { incremental, tables, files } = await afterUnstoredPull();
    tables["sys_script"] = tables["sys_script"]?.slice(1) ?? [];
    const { summary } = await incremental({ verify: true });
    expect(files.has(`${RULE}.yaml`)).toBe(false);
    expect(summary.unstored).toEqual({ count: 0, inMirror: 0, recovered: 0, records: [] });
    expect(summary.next.unstored).toBeUndefined();
  });

  it("re-reads a record under the class the instance gives it now", async () => {
    const { incremental, tables, show } = await afterUnstoredPull();
    show();
    const row = tables["sys_script"]?.shift();
    tables["wf_workflow"]?.push({ ...row, sys_class_name: "wf_workflow" });
    const { summary, queries } = await incremental({ verify: true });
    expect(queries.some((query) => String(query.table) === "sys_script")).toBe(false);
    expect(summary.unstored).toMatchObject({ count: 0, recovered: 1 });
  });

  it("adds no request to an incremental pull with no changes", async () => {
    const plain = await pulledInstance();
    const baseline = await plain.incremental();
    const { incremental, show } = await afterUnstoredPull();
    show();
    const { summary, queries, fingerprints, counted } = await incremental();
    expect(queries).toEqual([]);
    expect(fingerprints).toEqual(baseline.fingerprints);
    expect(counted).toEqual(baseline.counted);
    expect(summary.idle).toBe(true);
    // Still recorded: only pull --verify reads them again.
    expect(summary.next.unstored).toEqual(RECORDED);
  });

  it("adds no request to a verification when no record is recorded as unstored", async () => {
    const { incremental } = await pulledInstance();
    const { queries } = await incremental({ verify: true });
    expect(queries.filter((query) => query.query.startsWith("sys_idIN"))).toEqual([]);
  });

  it("stops recording a record a later pull stored or the instance deleted", async () => {
    const { incremental, tables, show, state } = await afterUnstoredPull();
    show();
    // Changed again after the first pull's watermark, and readable now.
    Object.assign(tables["sys_script"]?.[0] ?? {}, { sys_updated_on: "2026-10-05 10:55:00" });
    const { summary } = await incremental();
    expect(summary.next.unstored).toBeUndefined();
    expect(state.saved.state?.unstored).toEqual(RECORDED);
  });
});
