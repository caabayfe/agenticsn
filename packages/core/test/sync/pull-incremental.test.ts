import { describe, expect, it } from "bun:test";
import { FINGERPRINT_SOURCES } from "@snagentic/core";
import { CHANGED, FLOW, pulledInstance, RULE, sid, touch } from "../support/incremental-fixture";

describe("pullIncremental: nothing changed", () => {
  it("asks one aggregate per change source and nothing else, then moves the watermark", async () => {
    const { incremental } = await pulledInstance();
    const { summary, queries, fingerprints } = await incremental();
    expect(fingerprints.sort()).toEqual([...FINGERPRINT_SOURCES].sort());
    expect(queries).toEqual([]);
    expect(summary).toMatchObject({ changedSources: [], records: 0, childFiles: 0 });
    expect(summary.next.watermark).toBe("2026-10-05 11:00:00");
    expect(summary.next.lastFullPull).toBe("2026-10-05 10:00:00");
  });

  it("does not read the mirrored tree when nothing changed", async () => {
    const { incremental, prepared } = await pulledInstance();
    const before = prepared();
    await incremental();
    expect(prepared()).toBe(before);
  });

  it("leaves storing the new state to the caller, after the mirror commit", async () => {
    const { incremental, state } = await pulledInstance();
    await incremental();
    expect(state.saved.state?.watermark).toBe("2026-10-05 10:00:00");
  });

  it("requires a complete pull first", async () => {
    const { incremental, state } = await pulledInstance();
    state.saved.state = null;
    await expect(incremental()).rejects.toMatchObject({ code: "full-pull-required" });
  });
});

describe("pullIncremental: records", () => {
  it("reads the change feed from ten minutes before the watermark", async () => {
    const { incremental, tables } = await pulledInstance();
    touch(tables["sys_script"]?.[0], { script: "changed();" });
    const { queries } = await incremental();
    expect(String(queries[0]?.table)).toBe("sys_metadata");
    expect(queries[0]?.query).toStartWith("sys_updated_on>=2026-10-05 09:50:00");
    expect(queries[0]?.fields).not.toBe("all");
  });

  it("downloads only the changed record, whole, from its own class", async () => {
    const { incremental, tables, files } = await pulledInstance();
    touch(tables["sys_script"]?.[0], { script: "changed();" });
    const { summary, queries } = await incremental();
    expect(summary).toMatchObject({ changedSources: ["sys_metadata"], records: 1 });
    expect(files.get(`${RULE}.script.js`)).toBe("changed();\n");
    const download = queries.find((query) => query.table === "sys_script");
    expect(download?.query).toStartWith(`sys_class_name=sys_script^sys_idIN${sid(1)}`);
    expect(download?.fields).toBe("all");
  });

  it("adds a new record", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_script"]?.push({
      sys_id: sid(9),
      sys_class_name: "sys_script",
      name: "Nine",
      sys_scope: "global",
      sys_updated_on: CHANGED,
    });
    await incremental();
    expect(files.has(`global/sys_script/nine--${sid(9)}.yaml`)).toBe(true);
  });

  it("drops a field file when the field became empty", async () => {
    const { incremental, tables, files } = await pulledInstance();
    touch(tables["sys_script"]?.[0], { script: "" });
    await incremental();
    expect(files.has(`${RULE}.yaml`)).toBe(true);
    expect(files.has(`${RULE}.script.js`)).toBe(false);
  });

  it("moves a renamed record and its child rows to the new name", async () => {
    const { incremental, tables, files } = await pulledInstance();
    touch(tables["sys_hub_flow"]?.[0], { name: "Better flow" });
    const { summary } = await incremental();
    const renamed = `global/sys_hub_flow/better-flow--${sid(3)}`;
    expect(summary.renamed).toBe(1);
    expect([...files.keys()].filter((path) => path.startsWith(FLOW))).toEqual([]);
    expect(files.get(`${renamed}.children.sys_hub_flow_stage.yaml`)).toEqual([
      expect.objectContaining({ sys_id: "st1" }),
    ]);
  });

  it("removes a deleted record with all its files", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_hub_flow"] = [];
    // Deletion records are sys_metadata rows too, as on the instance.
    tables["sys_metadata_delete"]?.push({
      sys_id: "x1",
      sys_class_name: "sys_metadata_delete",
      sys_metadata: sid(3),
      sys_created_on: CHANGED,
      sys_updated_on: CHANGED,
    });
    const { summary } = await incremental();
    expect(summary.deleted).toBe(1);
    expect(summary.lostRecords).toBe(0);
    expect([...files.keys()].filter((path) => path.startsWith(FLOW))).toEqual([]);
  });

  it("reports records that vanished without a deletion record", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_script"] = tables["sys_script"]?.slice(0, 1) ?? [];
    const { summary } = await incremental();
    expect(summary.lostRecords).toBe(1);
    expect(files.has(`global/sys_script/two--${sid(2)}.yaml`)).toBe(true);
  });

  it("ignores classes a pull never mirrors, such as credentials", async () => {
    const { incremental, tables } = await pulledInstance();
    touch(tables["sys_cred"]?.[0], { name: "Rotated" });
    const { queries } = await incremental();
    expect(queries.some((query) => query.table === "sys_cred")).toBe(false);
  });

  it("reads the catalog again when a record belongs to a class it does not know", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_db_object"]?.push({ sys_id: "c9", name: "x_acme_rule", super_class: "c0" });
    tables["x_acme_rule"] = [
      {
        sys_id: sid(10),
        sys_class_name: "x_acme_rule",
        name: "Acme",
        sys_scope: "global",
        sys_updated_on: CHANGED,
      },
    ];
    const { summary } = await incremental();
    expect(summary.catalogRefreshed).toBe(true);
    expect(files.has(`global/x_acme_rule/acme--${sid(10)}.yaml`)).toBe(true);
  });
});

describe("pullIncremental: limited access", () => {
  it("names a changed class the user may not read and still applies the rest", async () => {
    const { incremental, tables, files, deny } = await pulledInstance();
    touch(tables["sys_script"]?.[0], { script: "changed();" });
    touch(tables["sys_hub_flow"]?.[0], { label: "x" });
    deny("sys_hub_flow");
    const { summary } = await incremental();
    expect(summary.unreadable).toContain("sys_hub_flow");
    expect(files.get(`${RULE}.script.js`)).toBe("changed();\n");
  });

  it("skips a changed record whose sys_id cannot be a path", async () => {
    const { incremental, tables } = await pulledInstance();
    tables["sys_script"]?.push({
      sys_id: "bad/id",
      sys_class_name: "sys_script",
      name: "Broken",
      sys_scope: "global",
      sys_updated_on: CHANGED,
    });
    const { summary } = await incremental();
    expect(summary.skippedRows).toBe(1);
  });
});
