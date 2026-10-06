import { describe, expect, it } from "bun:test";
import {
  type CodeHit,
  describeTable,
  find,
  fitted,
  type KnowledgeDependencies,
  RESULT_BUDGET,
  refreshIndex,
  sizeOf,
} from "@snagentic/core";
import { memoryMirror, memoryStore, record } from "../support/memory-knowledge";

const hex = (n: number) => n.toString(16).padStart(32, "0");

// A table far larger than any real one: 600 business rules and 300 fields.
async function bigTable(): Promise<KnowledgeDependencies> {
  const files: Record<string, ReturnType<typeof record>> = {};
  for (let i = 0; i < 600; i += 1) {
    files[`global/sys_script/a-rather-long-business-rule-name-${i}--${hex(i)}.yaml`] = record(
      "sys_script",
      hex(i),
      {
        name: `A rather long business rule name ${i}`,
        collection: "big",
        when: ["before", "after", "async"][i % 3] ?? "before",
        order: String(i),
        action_insert: "true",
        action_update: "true",
        action_delete: "false",
      },
    );
  }
  for (let i = 0; i < 300; i += 1) {
    files[`global/sys_dictionary/big-field-${i}--${hex(1000 + i)}.yaml`] = record(
      "sys_dictionary",
      hex(1000 + i),
      { name: "big", element: `u_field_${i}`, internal_type: "string", column_label: `Field ${i}` },
    );
  }
  const store = memoryStore();
  const { mirror, state } = memoryMirror(files);
  state.code = Array.from(
    { length: 400 },
    (_, i): CodeHit => ({
      path: `global/sys_script/a-rather-long-business-rule-name-${i % 50}--${hex(i % 50)}.script.js`,
      line: i,
      text: `var gr = new GlideRecord('big'); gr.addQuery('u_field', ${"x".repeat(150)});`,
    }),
  );
  await refreshIndex(store, mirror);
  return {
    store,
    files: mirror,
    catalog: { parents: { big: null }, scopes: {}, typedFields: {} },
    asOf: "2026-10-06 10:00:00",
    now: () => new Date("2026-10-06T12:00:00Z"),
  };
}

describe("result budget", () => {
  it("keeps a table description within budget, saying what was left out and how to get it", async () => {
    const table = await describeTable(await bigTable(), "big");
    expect(sizeOf(table)).toBeLessThanOrEqual(RESULT_BUDGET);
    expect(table.counts.before).toBe(200);
    expect(table.omitted.before).toBe(200 - (table.behavior.before?.length ?? 0));
    expect(table.fieldCount).toBe(300);
    expect(table.next).toContainEqual({
      tool: "describe",
      args: { target: "big", phase: "before" },
    });
  });

  it("lists one phase alone, without fields, still within budget", async () => {
    const table = await describeTable(await bigTable(), "big", { phase: "after" });
    expect(Object.keys(table.behavior)).toEqual(["after"]);
    expect(table.fields).toEqual([]);
    expect(sizeOf(table)).toBeLessThanOrEqual(RESULT_BUDGET);
    expect(table.behavior.after?.length).toBeGreaterThan(30);
  });

  it("writes behavior compactly: operations in one list, no false or timing details", async () => {
    const table = await describeTable(await bigTable(), "big");
    expect(table.behavior.before?.[0]).toEqual({
      kind: "business rule",
      name: "A rather long business rule name 0",
      order: 0,
      path: `global/sys_script/a-rather-long-business-rule-name-0--${hex(0)}.yaml`,
      details: { on: "insert, update" },
    });
  });

  it("trims code search results to the budget, keeping the best and counting extra lines", async () => {
    const result = await find(await bigTable(), { text: "GlideRecord", code: true, limit: 100 });
    expect(sizeOf(result)).toBeLessThanOrEqual(RESULT_BUDGET);
    expect(result.more).toBe(true);
    expect(result.records[0]?.matches).toHaveLength(5);
    expect(result.records[0]?.moreMatches).toBeGreaterThan(0);
  });

  it("returns a result that fits as it is", () => {
    expect(fitted((limit) => ({ limit }), 30)).toEqual({ limit: 30 });
  });
});
