import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { searchIndexProbe } from "../../src/adapters/search-index-probe";

describe("search index probe", () => {
  it("confirms the embedded SQLite supports FTS5", async () => {
    const check = await searchIndexProbe().run();
    expect(check).toMatchObject({ name: "search-index", status: "ok", hint: null });
    expect(check.detail).toMatch(/^SQLite \d+\.\d+\.\d+ with FTS5$/);
  });

  it("fails with a hint when the database cannot be opened", async () => {
    const check = await searchIndexProbe(() => {
      throw new Error("disk I/O error");
    }).run();
    expect(check).toMatchObject({ status: "fail" });
    expect(check.detail).toContain("disk I/O error");
    expect(check.hint).toContain("FTS5");
  });

  it("fails when full-text search returns unexpected results", async () => {
    const check = await searchIndexProbe(() => {
      const database = new Database(":memory:");
      const original = database.query.bind(database);
      database.query = ((sql: string) =>
        sql.includes("match")
          ? original("select 0 as hits")
          : original(sql)) as typeof database.query;
      return database;
    }).run();
    expect(check).toMatchObject({ status: "fail", detail: "FTS5 returned unexpected results" });
  });
});
