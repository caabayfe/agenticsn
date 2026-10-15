import { describe, expect, it } from "bun:test";
import { recordingOf, type TableAttributes } from "@snagentic/core";

const tables = (...rows: TableAttributes[]) => new Map(rows.map((row) => [row.name, row]));

describe("recording of a table (ADR-0030)", () => {
  it("reads update_synch, update_synch_custom, and the parent's when the table has neither", () => {
    const known = tables(
      { name: "sys_metadata", parent: "", attributes: "" },
      { name: "sys_script", parent: "sys_metadata", attributes: "update_synch=true" },
      { name: "sysauto", parent: "sys_metadata", attributes: "update_synch=false,foo=bar" },
      { name: "sysauto_script", parent: "sysauto", attributes: " update_synch = false " },
      { name: "cert_audit", parent: "sysauto_script", attributes: "" },
      { name: "sys_ui_list", parent: "sys_metadata", attributes: "update_synch_custom=true" },
    );
    expect(recordingOf("sys_script", known)).toBe("recorded");
    expect(recordingOf("sysauto_script", known)).toBe("unrecorded");
    expect(recordingOf("cert_audit", known)).toBe("unrecorded");
    expect(recordingOf("sys_ui_list", known)).toBe("custom");
  });

  it("takes a table nothing is known about as recorded, and survives a cycle", () => {
    expect(recordingOf("u_unknown", tables())).toBe("recorded");
    const cycle = tables(
      { name: "a", parent: "b", attributes: "" },
      { name: "b", parent: "a", attributes: "" },
    );
    expect(recordingOf("a", cycle)).toBe("recorded");
  });
});
