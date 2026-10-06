import { describe, expect, it } from "bun:test";
import { indexedRecord, recordBaseOfPath, refreshIndex } from "@snagentic/core";
import { memoryMirror, memoryStore, record } from "../support/memory-knowledge";

const BR = "global/sys_script/set-priority--b1.yaml";
const CS = "global/sys_script_client/hide-field--c1.yaml";

describe("indexedRecord", () => {
  it("keeps what describes a record without opening it", () => {
    const entry = indexedRecord(
      "global/sys_script/set-priority--b1",
      record("sys_script", "b1", {
        name: "Set priority",
        collection: "incident",
        when: "before",
        order: "50",
        active: "true",
        action_insert: "true",
        script: "x",
      }),
    );
    expect(entry).toEqual({
      base: "global/sys_script/set-priority--b1",
      sysId: "b1",
      className: "sys_script",
      scope: "global",
      name: "Set priority",
      table: "incident",
      phase: "before",
      order: 50,
      active: true,
      updatedOn: "2026-10-01 10:00:00",
      fields: { action_insert: "true", when: "before" },
    });
  });
});

describe("recordBaseOfPath", () => {
  it("recognises record files only", () => {
    expect(recordBaseOfPath(BR)).toBe("global/sys_script/set-priority--b1");
    expect(recordBaseOfPath("global/sys_script/set-priority--b1.script.js")).toBeNull();
    expect(
      recordBaseOfPath("global/sys_hub_flow/f--1.children.sys_hub_flow_stage.yaml"),
    ).toBeNull();
  });
});

describe("refreshIndex", () => {
  const files = {
    [BR]: record("sys_script", "b1", {
      name: "Set priority",
      collection: "incident",
      when: "before",
    }),
    [CS]: record("sys_script_client", "c1", {
      name: "Hide field",
      table: "incident",
      type: "onLoad",
    }),
    "global/sys_script/set-priority--b1.script.js": record("x", "x", {}),
  };

  it("builds the whole index the first time, from record files only", async () => {
    const store = memoryStore();
    const { mirror } = memoryMirror(files);
    expect(await refreshIndex(store, mirror)).toEqual({
      indexed: 2,
      removed: 0,
      records: 2,
      rebuilt: true,
    });
  });

  it("then reads only what was committed since, edited now, or edited last time", async () => {
    const store = memoryStore();
    const { mirror, state } = memoryMirror(files);
    await refreshIndex(store, mirror);
    // A local edit: indexed as it is now.
    state.files[BR] = record("sys_script", "b1", {
      name: "Set priority (edited)",
      collection: "incident",
      when: "before",
    });
    state.dirty = [BR];
    expect((await refreshIndex(store, mirror)).indexed).toBe(1);
    expect(store.records.get("global/sys_script/set-priority--b1")?.name).toBe(
      "Set priority (edited)",
    );
    // The edit is undone: still re-read, because it was dirty last time.
    state.files[BR] = record("sys_script", "b1", {
      name: "Set priority",
      collection: "incident",
      when: "before",
    });
    state.dirty = [];
    expect((await refreshIndex(store, mirror)).indexed).toBe(1);
    expect(store.records.get("global/sys_script/set-priority--b1")?.name).toBe("Set priority");
    // Nothing changed: nothing read.
    expect((await refreshIndex(store, mirror)).indexed).toBe(0);
  });

  it("removes records whose files are gone after a pull was integrated", async () => {
    const store = memoryStore();
    const { mirror, state } = memoryMirror(files);
    await refreshIndex(store, mirror);
    delete state.files[CS];
    state.head = "c2";
    state.committedSince.set("c1", [CS]);
    expect(await refreshIndex(store, mirror)).toMatchObject({ removed: 1, records: 1 });
  });

  it("does nothing in a workspace with no commit yet", async () => {
    const { mirror, state } = memoryMirror(files);
    state.head = null;
    expect(await refreshIndex(memoryStore(), mirror)).toEqual({
      indexed: 0,
      removed: 0,
      records: 0,
      rebuilt: false,
    });
  });
});
