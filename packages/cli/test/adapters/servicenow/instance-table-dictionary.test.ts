import { describe, expect, it } from "bun:test";
import type { InstanceReader, TableQuery } from "@snagentic/core";
import { InstanceTableDictionary } from "../../../src/adapters/servicenow/instance-table-dictionary";

describe("instance table dictionary (ADR-0030)", () => {
  it("reads each table's parent and collection attributes by name, in batches", async () => {
    const queries: TableQuery[] = [];
    const reader: InstanceReader = {
      query: async (query) => {
        queries.push(query);
        if (query.table === "sys_db_object") {
          return [
            { name: "sysauto_script", "super_class.name": "sysauto" },
            { name: "u_plain", "super_class.name": "" },
          ];
        }
        return [{ name: "sysauto_script", attributes: "update_synch=false" }];
      },
      stats: () => {
        throw new Error("not used");
      },
    };
    const names = Array.from({ length: 51 }, (_, i) => (i === 0 ? "sysauto_script" : `u_${i}`));
    const tables = await new InstanceTableDictionary(reader).tables(
      names,
      new AbortController().signal,
    );
    expect(tables).toContainEqual({
      name: "sysauto_script",
      parent: "sysauto",
      attributes: "update_synch=false",
    });
    expect(tables).toContainEqual({ name: "u_plain", parent: "", attributes: "" });
    expect(queries).toHaveLength(4);
    expect(queries[0]).toMatchObject({
      table: "sys_db_object",
      fields: ["name", "super_class.name"],
      limit: 100,
    });
    expect(queries[1]?.query).toEndWith("^internal_type=collection");
  });
});
