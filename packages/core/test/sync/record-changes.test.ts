import { describe, expect, it } from "bun:test";
import { Catalog, chunks, isChildRowFile, needsNewCatalog, unexplainedLoss } from "@snagentic/core";

const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata", sys_db_object: "sys_metadata" },
  scopes: { s1: "x_acme" },
  typedFields: {},
});
const changes = (classes: string[], scopes: string[] = ["global"]) => ({
  changed: new Map(classes.map((table) => [table, ["id"]])),
  scopes: new Set(scopes),
  deleted: [],
  createdBetween: 0,
  deletedBetween: 0,
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

describe("unexplainedLoss", () => {
  const feeds = (createdBetween: number, deletedBetween: number) => ({
    ...changes([]),
    createdBetween,
    deletedBetween,
  });

  it("is zero when creations and deletion records explain the count", () => {
    // One record deleted: its deletion record is itself a new sys_metadata row.
    expect(unexplainedLoss(100, 100, feeds(1, 1))).toBe(0);
    expect(unexplainedLoss(100, 103, feeds(3, 0))).toBe(0);
  });

  it("counts records that vanished without a deletion record", () => {
    expect(unexplainedLoss(100, 99, feeds(0, 0))).toBe(1);
    expect(unexplainedLoss(100, 100, feeds(2, 0))).toBe(2);
  });

  it("is never negative", () => {
    expect(unexplainedLoss(100, 100, feeds(0, 1))).toBe(0);
  });
});
