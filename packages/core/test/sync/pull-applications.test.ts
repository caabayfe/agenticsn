import { describe, expect, it } from "bun:test";
import type { Row } from "@snagentic/core";
import { BEFORE, pulledInstance, sid } from "../support/incremental-fixture";

const APP = sid(50);
const app = (fields: Row = {}): Row => ({
  sys_id: APP,
  name: "Access Review",
  scope: "x_acme_access_rev",
  version: "1.0.0",
  sys_updated_on: BEFORE,
  ...fields,
});
const FILE = `x_acme_access_rev/sys_app/access-review--${APP}.yaml`;

// An application is a sys_scope row on the instance: changing one moves that table's fingerprint.
function changeApplications(tables: Record<string, Row[]>, apps: Row[]): void {
  tables["sys_app"] = apps;
  tables["sys_scope"] = [
    ...(tables["sys_scope"] ?? []),
    { sys_id: sid(60), scope: "x_acme_changed", sys_updated_on: "2026-10-05 10:30:00" },
  ];
}

describe("pull: custom applications (ADR-0025)", () => {
  it("writes each application as a record of its own scope", async () => {
    const { files } = await pulledInstance((tables) => {
      tables["sys_app"] = [app()];
    });
    expect(files.get(FILE)).toMatchObject({
      _meta: { scope: "x_acme_access_rev", sys_class_name: "sys_app", sys_id: APP },
      name: "Access Review",
      version: "1.0.0",
    });
  });

  it("reads applications again when an application changed, though no change feed shows it", async () => {
    const { incremental, tables, files } = await pulledInstance((t) => {
      t["sys_app"] = [app()];
    });
    tables["sys_app"] = [app({ version: "1.1.0" })];
    const unchanged = await incremental();
    expect(unchanged.queries.some((query) => String(query.table) === "sys_app")).toBe(false);
    changeApplications(tables, [app({ version: "1.1.0" })]);
    await incremental();
    expect(files.get(FILE)).toMatchObject({ version: "1.1.0" });
  });

  it("removes the file of an application renamed or deleted on the instance", async () => {
    const { incremental, tables, files } = await pulledInstance((t) => {
      t["sys_app"] = [app(), app({ sys_id: sid(51), name: "Old tool", scope: "x_acme_old" })];
    });
    changeApplications(tables, [app({ name: "Access Reviews" })]);
    await incremental();
    expect(files.has(FILE)).toBe(false);
    expect(files.has(`x_acme_access_rev/sys_app/access-reviews--${APP}.yaml`)).toBe(true);
    expect([...files.keys()].some((path) => path.includes(sid(51)))).toBe(false);
  });

  it("names applications the user may not read as unreadable, and goes on", async () => {
    const { incremental, deny, tables } = await pulledInstance((t) => {
      t["sys_app"] = [app()];
    });
    changeApplications(tables, [app()]);
    deny("sys_app");
    const { summary } = await incremental();
    expect(summary.unreadable).toContain("sys_app");
  });
});
