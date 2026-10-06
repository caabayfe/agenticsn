import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexedRecord } from "@snagentic/core";
import { SqliteKnowledgeStore } from "../../../src/adapters/knowledge/sqlite-knowledge-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-knowledge-"));
  temporary.push(dir);
  return {
    path: join(dir, "knowledge.sqlite"),
    store: new SqliteKnowledgeStore(join(dir, "knowledge.sqlite")),
  };
}

const record = (base: string, extra: Partial<IndexedRecord> = {}): IndexedRecord => ({
  base,
  sysId: base.slice(-2),
  className: "sys_script",
  scope: "global",
  name: "Set priority",
  table: "incident",
  phase: "before",
  order: 100,
  active: true,
  updatedOn: "2026-10-01 10:00:00",
  fields: { when: "before" },
  ...extra,
});
const entry = (base: string, extra: Partial<IndexedRecord> = {}, text = "") => ({
  record: record(base, extra),
  text,
});

describe("SqliteKnowledgeStore", () => {
  it("stores records and the marker together, and reads them back", async () => {
    const { store: s } = await store();
    expect(await s.marker()).toBeNull();
    await s.apply([entry("global/sys_script/a--b1")], [], { commit: "c1", dirty: ["x.yaml"] });
    expect(await s.marker()).toEqual({ commit: "c1", dirty: ["x.yaml"] });
    expect(await s.bySysId("b1")).toEqual(record("global/sys_script/a--b1"));
    expect(await s.byBases(["global/sys_script/a--b1", "missing"])).toHaveLength(1);
    expect(await s.count()).toBe(1);
  });

  it("replaces an updated record and removes deleted ones", async () => {
    const { store: s } = await store();
    await s.apply([entry("a--b1"), entry("b--b2")], [], { commit: "c1", dirty: [] });
    await s.apply([entry("a--b1", { name: "Renamed" })], ["b--b2"], { commit: "c2", dirty: [] });
    expect((await s.search({ limit: 10 })).records.map((r) => r.name)).toEqual(["Renamed"]);
  });

  it("finds records by words of their name, class, table or scope, prefixes included", async () => {
    const { store: s } = await store();
    await s.apply(
      [
        entry("a--b1", { name: "Set priority from impact" }),
        entry("b--b2", { name: "Close child incidents", table: "incident" }),
        entry("c--b3", {
          name: "Approve change",
          table: "change_request",
          className: "sys_script_client",
        }),
      ],
      [],
      { commit: "c1", dirty: [] },
    );
    expect((await s.search({ text: "prior", limit: 10 })).records.map((r) => r.base)).toEqual([
      "a--b1",
    ]);
    expect((await s.search({ text: "change_request", limit: 10 })).total).toBe(1);
    expect((await s.search({ text: "incident", className: "sys_script", limit: 10 })).total).toBe(
      2,
    );
    expect((await s.search({ table: "change_request", limit: 10 })).records[0]?.base).toBe("c--b3");
  });

  it("treats search syntax in the user's text as plain words", async () => {
    const { store: s } = await store();
    await s.apply([entry("a--b1")], [], { commit: "c1", dirty: [] });
    expect((await s.search({ text: 'priority" OR (x', limit: 10 })).total).toBe(0);
    expect((await s.search({ text: "set-priority", limit: 10 })).total).toBe(1);
  });

  it("lists the behavior of several tables at once", async () => {
    const { store: s } = await store();
    await s.apply(
      [entry("a--b1"), entry("b--b2", { table: "task" }), entry("c--b3", { table: "problem" })],
      [],
      { commit: "c1", dirty: [] },
    );
    expect((await s.onTables(["incident", "task"])).map((r) => r.base).sort()).toEqual([
      "a--b1",
      "b--b2",
    ]);
  });

  it("rebuilds an index written with another schema version", async () => {
    const { path, store: s } = await store();
    await s.apply([entry("a--b1")], [], { commit: "c1", dirty: [] });
    s.close();
    const raw = new Database(path);
    raw.run("pragma user_version = 99");
    raw.close();
    const reopened = new SqliteKnowledgeStore(path);
    expect(await reopened.count()).toBe(0);
    expect(await reopened.marker()).toBeNull();
    reopened.close();
  });

  it("finds the records whose files contain words or a sequence of words", async () => {
    const { store: s } = await store();
    await s.apply(
      [
        entry("a--b1", {}, "var util = new TaskStateUtil(current);"),
        entry(
          "b--b2",
          {},
          "new ProblemTaskStateUtilsSNC().run(); parent: 96e1ade7c0a80a6d381ba0c6aeb4ad61",
        ),
        entry("c--b3", {}, "current.update();"),
      ],
      [],
      { commit: "c1", dirty: [] },
    );
    expect(await s.containing(["TaskStateUtil"], 10)).toEqual(["a--b1"]);
    expect(await s.containing(["TaskStateUtil", "96e1ade7c0a80a6d381ba0c6aeb4ad61"], 10)).toEqual([
      "a--b1",
      "b--b2",
    ]);
    expect(await s.containing(["current.update()"], 10)).toEqual(["c--b3"]);
    expect(await s.containing(["update current"], 10)).toEqual([]);
    expect(await s.containing(["()"], 10)).toEqual([]);
  });

  it("forgets a record's words when it is updated or removed", async () => {
    const { store: s } = await store();
    await s.apply([entry("a--b1", {}, "old words")], [], { commit: "c1", dirty: [] });
    await s.apply([entry("a--b1", {}, "new words")], [], { commit: "c2", dirty: [] });
    expect(await s.containing(["old"], 10)).toEqual([]);
    expect(await s.containing(["new"], 10)).toEqual(["a--b1"]);
    await s.apply([], ["a--b1"], { commit: "c3", dirty: [] });
    expect(await s.containing(["new"], 10)).toEqual([]);
  });
});
