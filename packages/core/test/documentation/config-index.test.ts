import { describe, expect, it } from "bun:test";
import {
  appliesTo,
  CONFIG_RECORD_TYPES,
  checkDocs,
  configIndex,
  groupByType,
  loadDocumentation,
  recordDetails,
  recordName,
  worstStatus,
} from "@snagentic/core";
import { ALL, fakeMirror, fakeSources, PROCESS, RULE, run } from "../support/docs-fixtures";

async function indexOf(process: unknown) {
  const { sources } = fakeSources(ALL, { process });
  const docs = await loadDocumentation(sources, "/ws");
  const check = await checkDocs({ ...run, sources });
  const [first] = docs.processes;
  if (first === undefined) {
    throw new Error("no process");
  }
  return configIndex(docs, first, fakeMirror(), check, run.signal);
}

describe("configuration index", () => {
  it("lists every record the pages cite once, with the pages that cite it and its freshness", async () => {
    const index = await indexOf(PROCESS);
    const action = index.cited.find((record) => record.table === "sys_ui_action");
    expect(action).toMatchObject({ name: "Resolve", status: "fresh" });
    expect(action?.citedBy.map((page) => page.file)).toEqual([
      "processes/incident/operate/resolve.html",
      "processes/incident/configure/resolve.html",
    ]);
    expect(index.cited.find((record) => record.sysId === RULE)?.name).toBe("Set group");
    expect(index.cited).toHaveLength(4);
  });

  it("lists the active records on the process's tables that no page cites", async () => {
    const index = await indexOf({ ...PROCESS, tables: ["incident"] });
    expect(index.uncited.map((record) => [record.name, record.details, record.updated])).toEqual([
      ["Mark VIP", ["when after", "order 100"], "admin, 2026-05-01 10:00:00"],
      ["incident.close_code", ["operation write"], undefined],
    ]);
  });

  it("lists nothing uncited when the process names no tables", async () => {
    expect((await indexOf(PROCESS)).uncited).toEqual([]);
  });

  it("matches access controls by table or table.field, and other types by their table field", () => {
    const [rules, acls] = CONFIG_RECORD_TYPES;
    if (rules === undefined || acls === undefined) {
      throw new Error("types");
    }
    expect(appliesTo(acls, { name: "incident.state" }, ["incident"])).toBe(true);
    expect(appliesTo(acls, { name: "incident_task" }, ["incident"])).toBe(false);
    expect(appliesTo(rules, { collection: "incident" }, ["incident"])).toBe(true);
    expect(appliesTo(rules, {}, ["incident"])).toBe(false);
  });

  it("names a record by its first naming field, and shows when it runs and whether it is off", () => {
    expect(recordName({ title: "Unassigned" })).toBe("Unassigned");
    expect(recordName({ name: " " })).toBe("(no name)");
    expect(recordDetails({ active: "false", when: "before", action_name: "resolve" })).toEqual([
      "inactive",
      "when before",
      "action resolve",
    ]);
  });

  it("takes the worst status, and groups records by type in reading order", () => {
    expect(worstStatus(["fresh", "changed", "seen"])).toBe("changed");
    expect(worstStatus([])).toBeNull();
    const entry = (table: string, name: string) => ({
      table,
      sysId: name,
      name,
      details: [],
      citedBy: [],
      status: null,
    });
    const groups = groupByType([
      entry("sc_cat_item_producer", "Report"),
      entry("sys_security_acl", "b"),
      entry("sys_script", "z"),
      entry("sys_script", "a"),
    ]);
    expect(
      groups.map((group) => [group.title, group.records.map((record) => record.name)]),
    ).toEqual([
      ["Business rules", ["a", "z"]],
      ["Access controls", ["b"]],
      ["Other records", ["Report"]],
    ]);
  });
});
