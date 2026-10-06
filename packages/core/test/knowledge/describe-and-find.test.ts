import { describe, expect, it } from "bun:test";
import {
  describeRecord,
  describeTable,
  find,
  indexedRecord,
  type KnowledgeDependencies,
  refreshIndex,
} from "@snagentic/core";
import { memoryMirror, memoryStore, record } from "../support/memory-knowledge";

const FILES = {
  "global/sys_script/set-priority--b1.yaml": record("sys_script", "b1", {
    name: "Set priority",
    collection: "incident",
    when: "before",
    order: "200",
  }),
  "global/sys_script/validate--b2.yaml": record("sys_script", "b2", {
    name: "Validate",
    collection: "incident",
    when: "before",
    order: "50",
  }),
  "global/sys_script/close-children--b3.yaml": record("sys_script", "b3", {
    name: "Close children",
    collection: "task",
    when: "after",
  }),
  "global/sys_script/old--b4.yaml": record("sys_script", "b4", {
    name: "Old rule",
    collection: "incident",
    when: "before",
    active: "false",
  }),
  "global/sys_script_client/hide--c1.yaml": record("sys_script_client", "c1", {
    name: "Hide",
    table: "incident",
    type: "onLoad",
  }),
  "global/sys_security_acl/incident--a1.yaml": record("sys_security_acl", "a1", {
    name: "incident.priority",
  }),
  "global/sys_dictionary/incident-priority--d1.yaml": record("sys_dictionary", "d1", {
    name: "incident",
    element: "priority",
    internal_type: "integer",
    column_label: "Priority",
    mandatory: "true",
  }),
  "global/sys_dictionary/task-number--d2.yaml": record("sys_dictionary", "d2", {
    name: "task",
    element: "number",
    internal_type: "string",
    column_label: "Number",
  }),
  "global/sys_script_include/prioritizer--s1.yaml": record("sys_script_include", "s1", {
    name: "Prioritizer",
  }),
};

async function deps(
  asOf: string | null = "2026-10-06 10:00:00",
): Promise<KnowledgeDependencies & { state: ReturnType<typeof memoryMirror>["state"] }> {
  const store = memoryStore();
  const { mirror, state } = memoryMirror(FILES);
  state.code = [
    {
      path: "global/sys_script/set-priority--b1.script.js",
      line: 3,
      text: "new Prioritizer().apply(current);",
    },
    {
      path: "global/sys_script_include/prioritizer--s1.script.js",
      line: 1,
      text: "var Prioritizer = Class.create();",
    },
  ];
  state.beside["global/sys_script_include/prioritizer--s1"] = [
    "global/sys_script_include/prioritizer--s1.script.js",
    "global/sys_script_include/prioritizer--s1.yaml",
  ];
  await refreshIndex(store, mirror);
  return {
    store,
    files: mirror,
    catalog: { parents: { incident: "task", task: null }, scopes: {}, typedFields: {} },
    asOf,
    now: () => new Date("2026-10-06T12:00:00Z"),
    state,
  };
}

describe("describeTable", () => {
  it("lists behavior by phase in execution order, inherited behavior included and marked", async () => {
    const table = await describeTable(await deps(), "incident");
    expect(table.inherits).toEqual(["incident", "task"]);
    expect(table.behavior.before?.map((b) => [b.name, b.order])).toEqual([
      ["Validate", 50],
      ["Set priority", 200],
    ]);
    expect(table.behavior.after).toEqual([
      expect.objectContaining({ name: "Close children", inheritedFrom: "task" }),
    ]);
    expect(table.behavior.client?.[0]).toMatchObject({
      kind: "client script",
      details: { type: "onLoad" },
    });
    expect(table.behavior.access?.[0]).toMatchObject({ kind: "ACL", name: "incident.priority" });
    expect(table.next[0]).toEqual({
      tool: "describe",
      args: { target: "global/sys_script/validate--b2.yaml" },
    });
  });

  it("leaves inactive behavior out, counting it, unless asked", async () => {
    const d = await deps();
    expect((await describeTable(d, "incident")).omitted.before).toBe(1);
    expect(
      (await describeTable(d, "incident", { includeInactive: true })).behavior.before,
    ).toHaveLength(3);
  });

  it("lists the table's fields, its own and its parents'", async () => {
    const table = await describeTable(await deps(), "incident");
    expect(table.fields).toEqual([
      { name: "number", type: "string", label: "Number", definedOn: "task" },
      { name: "priority", type: "integer", label: "Priority", mandatory: true },
    ]);
    expect(table.fieldCount).toBe(2);
  });

  it("says how fresh the mirror is, and what it does not cover yet", async () => {
    expect(await describeTable(await deps("2026-10-06 10:00:00"), "incident")).toMatchObject({
      asOf: "2026-10-06 10:00:00",
      stale: false,
    });
    expect(await describeTable(await deps("2026-10-01 10:00:00"), "incident")).toMatchObject({
      stale: true,
    });
    expect((await describeTable(await deps(), "incident")).notCovered[0]).toContain("flows");
  });

  it("reports an unknown table rather than an empty one", async () => {
    expect(await describeTable(await deps(), "nope")).toMatchObject({
      known: false,
      inherits: ["nope"],
    });
  });
});

describe("describeRecord", () => {
  it("describes a record by path, with its files and who refers to it", async () => {
    const record = await describeRecord(
      await deps(),
      "global/sys_script_include/prioritizer--s1.yaml",
    );
    expect(record).toMatchObject({
      sysId: "s1",
      className: "sys_script_include",
      name: "Prioritizer",
    });
    expect(record.files).toEqual(["global/sys_script_include/prioritizer--s1.script.js"]);
    expect(record.usedBy).toEqual([
      {
        path: "global/sys_script/set-priority--b1.yaml",
        name: "Set priority",
        className: "sys_script",
        line: 3,
        text: "new Prioritizer().apply(current);",
      },
    ]);
  });

  it("finds a record by sys_id, and points to its table", async () => {
    const record = await describeRecord(await deps(), "b1");
    expect(record.path).toBe("global/sys_script/set-priority--b1.yaml");
    expect(record.next).toEqual([{ tool: "describe", args: { target: "incident" } }]);
  });

  it("explains a target it cannot find", async () => {
    await expect(describeRecord(await deps(), "zzz")).rejects.toMatchObject({
      code: "record-not-found",
    });
  });
});

describe("find", () => {
  it("finds records by name, and suggests describing the best match", async () => {
    const result = await find(await deps(), { text: "priority", limit: 10 });
    expect(result.records.map((r) => r.name)).toEqual([
      "Set priority",
      "incident.priority",
      "incident.priority",
    ]);
    expect(result.records.map((r) => r.className)).toEqual([
      "sys_script",
      "sys_security_acl",
      "sys_dictionary",
    ]);
    expect(result.next[0]?.tool).toBe("describe");
  });

  it("finds records by text in their code, grouped per record with the lines", async () => {
    const result = await find(await deps(), { text: "Prioritizer", code: true, limit: 10 });
    expect(result.records.map((r) => [r.name, r.matches?.[0]?.line])).toEqual([
      ["Set priority", 3],
      ["Prioritizer", 1],
    ]);
  });

  it("suggests searching code when no name matches", async () => {
    const result = await find(await deps(), { text: "GlideAggregate", limit: 10 });
    expect(result.next).toEqual([{ tool: "find", args: { text: "GlideAggregate", code: true } }]);
  });

  it("narrows by class and table", async () => {
    const result = await find(await deps(), {
      text: "priority",
      className: "sys_script",
      table: "incident",
      limit: 10,
    });
    expect(result.records.map((r) => r.name)).toEqual(["Set priority"]);
  });
});

it("indexedRecord is exported for adapters", () => {
  expect(typeof indexedRecord).toBe("function");
});
