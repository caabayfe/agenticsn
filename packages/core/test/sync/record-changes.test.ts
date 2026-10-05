import { describe, expect, it } from "bun:test";
import { Catalog, chunks, isChildRowFile, needsNewCatalog } from "@snagentic/core";

const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata", sys_db_object: "sys_metadata" },
  scopes: { s1: "x_acme" },
  typedFields: {},
});
const changes = (classes: string[], scopes: string[] = ["global"]) => ({
  changed: new Map(classes.map((table) => [table, ["id"]])),
  scopes: new Set(scopes),
  deleted: [],
});

describe("needsNewCatalog", () => {
  it("keeps the catalog for changes it already describes", () => {
    expect(needsNewCatalog(changes(["sys_script"], ["global", "s1", ""]), catalog)).toBe(false);
  });

  it.each([
    ["a table changed", changes(["sys_db_object"])],
    ["a field type may have changed", changes(["sys_dictionary"])],
    ["a record is in an unknown class", changes(["x_acme_new_table"])],
    ["a record is in a new scope", changes(["sys_script"], ["s2"])],
  ])("asks for a new catalog when %s", (_reason, change) => {
    expect(needsNewCatalog(change, catalog)).toBe(true);
  });
});

describe("isChildRowFile", () => {
  it("tells child-row files from a record's own files", () => {
    expect(isChildRowFile("a/flow--1", "a/flow--1.children.sys_hub_flow_stage.yaml")).toBe(true);
    expect(isChildRowFile("a/flow--1", "a/flow--1.yaml")).toBe(false);
    expect(isChildRowFile("a/flow--1", "a/flow--1.script.js")).toBe(false);
  });
});

describe("chunks", () => {
  it("splits a list into batches of at most the given size", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
