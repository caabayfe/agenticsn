import { describe, expect, it } from "bun:test";
import { readUnits } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";
import { LIST_ID, record, revocationList, scriptInclude, unit } from "./units";

const signal = new AbortController().signal;
const stamp = { sys_mod_count: "2", sys_updated_on: "2026-10-16 06:30:48" };

const instance = () =>
  fakeInstance({
    sys_script_include: [
      { sys_id: "123833b4d97d48be8e9ec5ea16f27764", name: "E2EUtil", description: "d", ...stamp },
    ],
    // The build names a column with a new sys_id; the platform matches it by table and column.
    sys_dictionary: [
      { sys_id: "9".repeat(32), name: "x_t", element: "status", column_label: "Status", ...stamp },
      { sys_id: "8".repeat(32), name: "x_t", element: "owner", column_label: "Owner", ...stamp },
    ],
    sys_ui_list: [
      {
        sys_id: LIST_ID,
        name: "x_2222332_acc_rev_revocation",
        view: "Default view",
        "view.name": "",
        parent: "",
        relationship: "",
        sys_domain: "global",
        ...stamp,
      },
    ],
    sys_ui_list_element: [
      {
        sys_id: "1".repeat(32),
        list_id: LIST_ID,
        element: "number",
        position: "0",
        sys_domain: "global",
        ...stamp,
      },
      {
        sys_id: "2".repeat(32),
        list_id: LIST_ID,
        element: "state",
        position: "1",
        sys_domain: "global",
        ...stamp,
      },
      // A domain's override of the list: not the unit's row.
      {
        sys_id: "3".repeat(32),
        list_id: LIST_ID,
        element: "number",
        position: "0",
        sys_domain: "d1",
        ...stamp,
      },
    ],
  });

const column = (sysId: string, element: string) =>
  unit(
    `sys_dictionary_x_t_${element}`,
    record("sys_dictionary", sysId, { name: "x_t", element, column_label: "x" }),
  );

describe("readUnits (ADR-0033 item 1)", () => {
  it("reads a record by sys_id, with the fields the build wrote and its version", async () => {
    const fake = instance();
    const copies = await readUnits(fake.reader, [scriptInclude("new")], signal);
    expect(copies.get(`sys_script_include_123833b4d97d48be8e9ec5ea16f27764`)).toMatchObject({
      head: { name: "E2EUtil", description: "d" },
      children: [],
      version: "2|2026-10-16 06:30:48",
      foreignRows: 0,
    });
    expect(fake.queries[0]?.fields).toContain("description");
  });

  it("finds columns by table and column in one listing when the build gave them new sys_ids", async () => {
    const fake = instance();
    const copies = await readUnits(
      fake.reader,
      [column("a".repeat(32), "status"), column("b".repeat(32), "owner")],
      signal,
    );
    expect(copies.get("sys_dictionary_x_t_status")?.head["sys_id"]).toBe("9".repeat(32));
    expect(copies.get("sys_dictionary_x_t_owner")?.head["sys_id"]).toBe("8".repeat(32));
    const byKeys = fake.queries.filter((q) => q.query.includes("element"));
    // One listing: its first page, and the empty page that ends it.
    expect(byKeys.length).toBeGreaterThan(0);
    expect(byKeys.every((q) => q.query.startsWith("name=x_t^elementINstatus,owner"))).toBe(true);
  });

  it("reads a list with its own rows, counts other domains' rows apart, and versions all of them", async () => {
    const copies = await readUnits(
      instance().reader,
      [revocationList(["number", "state"])],
      signal,
    );
    const list = copies.get("sys_ui_list_x_2222332_acc_rev_revocation_null");
    expect(list?.children.map((row) => row["element"])).toEqual(["number", "state"]);
    expect(list?.foreignRows).toBe(1);
    expect(list?.version).toMatch(/^2\|2026-10-16 06:30:48\|rows:3:[0-9a-f]{16}$/);
  });

  it("answers null for a unit the instance does not hold", async () => {
    const copies = await readUnits(instance().reader, [column("c".repeat(32), "missing")], signal);
    expect(copies.get("sys_dictionary_x_t_missing")).toBeNull();
  });
});
