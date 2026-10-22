import { describe, expect, it } from "bun:test";
import { type LedgerEntry, planUnit, unitDigest } from "@snagentic/core";
import { copy, listCopy, record, revocationList, scriptInclude, unit } from "./units";

const INSTANCE = {
  sys_id: "123833b4d97d48be8e9ec5ea16f27764",
  active: "true",
  api_name: "x_2222332_s11.E2EUtil",
  caller_access: "",
  client_callable: "false",
  description: "Helpers for the E2E probe.",
  name: "E2EUtil",
};
const VERSION = "1|2026-10-16 06:30:48";
const adopted = scriptInclude("Helpers for the E2E probe.");
const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  build: unitDigest(adopted),
  instance: VERSION,
  losses: [],
  ...overrides,
});

describe("planUnit (ADR-0033 item 4)", () => {
  it("loads an authored change when the instance has not moved since it agreed with source", () => {
    const edited = scriptInclude("Edited in source.");
    const decision = planUnit(edited, unitDigest(edited), copy(INSTANCE, [], VERSION), entry());
    expect(decision).toMatchObject({ kind: "load", losses: [] });
    expect(
      decision.kind === "load" && decision.differences.map((d) => d.kind === "field" && d.field),
    ).toEqual(["description"]);
  });

  it("refuses as drift when someone saved the unit on the instance since", () => {
    const edited = scriptInclude("Edited in source.");
    const moved = copy(
      { ...INSTANCE, description: "Edited on the instance." },
      [],
      "2|2026-10-16 09:00:00",
    );
    expect(planUnit(edited, unitDigest(edited), moved, entry())).toMatchObject({ kind: "drift" });
  });

  it("loads nothing when the instance already holds the build, and records it when the ledger is behind", () => {
    const edited = scriptInclude("Edited in source.");
    const applied = copy(
      { ...INSTANCE, description: "Edited in source." },
      [],
      "9|2026-10-16 10:00:00",
    );
    expect(planUnit(edited, unitDigest(edited), applied, entry())).toEqual({ kind: "record" });
    const current = entry({ build: unitDigest(edited), instance: "9|2026-10-16 10:00:00" });
    expect(planUnit(edited, unitDigest(edited), applied, current)).toEqual({ kind: "none" });
  });

  it("loads nothing for an adopted unit both sides still agree on", () => {
    expect(planUnit(adopted, unitDigest(adopted), copy(INSTANCE, [], VERSION), entry())).toEqual({
      kind: "none",
    });
  });

  it("refuses a unit the instance holds and this branch never adopted", () => {
    const edited = scriptInclude("Edited in source.");
    expect(planUnit(edited, unitDigest(edited), copy(INSTANCE), undefined)).toMatchObject({
      kind: "not-adopted",
    });
  });

  it("creates a unit the instance does not hold", () => {
    expect(planUnit(adopted, unitDigest(adopted), null, undefined)).toEqual({ kind: "create" });
  });

  // ADR-0033 as amended (2026-10-22): a plugin activation can remove a record without a trace;
  // the plan says so, and approving it approves creating the record again.
  it("creates again a unit deleted on the instance since it agreed with source", () => {
    expect(planUnit(adopted, unitDigest(adopted), null, entry())).toEqual({ kind: "create" });
  });

  it("keeps known losses accepted at adoption out of the plan while source is unchanged", () => {
    const job = unit(
      "sysauto_script_x",
      record("sysauto_script", "a".repeat(32), { run_dayofweek: "1" }),
    );
    const instance = copy({ run_dayofweek: "" }, [], VERSION);
    const accepted = {
      build: unitDigest(job),
      instance: VERSION,
      losses: ["api-default" as const],
    };
    expect(planUnit(job, unitDigest(job), instance, accepted)).toEqual({ kind: "none" });
  });

  it("lists the known losses a load also sets", () => {
    const job = unit(
      "sysauto_script_x",
      record("sysauto_script", "a".repeat(32), { name: "Nightly", run_dayofweek: "1" }),
    );
    const instance = copy({ name: "Daily", run_dayofweek: "" }, [], VERSION);
    const before = { build: "older", instance: VERSION, losses: [] };
    expect(planUnit(job, unitDigest(job), instance, before)).toMatchObject({
      kind: "load",
      losses: ["api-default"],
    });
  });

  it("never loads a unit with rows in other domains", () => {
    const list = revocationList(["number", "state"]);
    const instance = { ...listCopy(["number"], VERSION), foreignRows: 2 };
    const before = { build: "older", instance: VERSION, losses: [] };
    expect(planUnit(list, unitDigest(list), instance, before)).toMatchObject({ kind: "unsafe" });
  });

  it("deletes a record a Now.del names, and skips one already gone", () => {
    const deletion = unit("sys_properties_x", {
      ...record("sys_properties", "a".repeat(32), {}),
      action: "DELETE",
    });
    expect(planUnit(deletion, unitDigest(deletion), copy({ name: "x" }), undefined)).toEqual({
      kind: "delete",
    });
    expect(planUnit(deletion, unitDigest(deletion), null, undefined)).toEqual({ kind: "none" });
  });

  it("decides a compiled unit (a flow) by the ledger alone", () => {
    const flow = unit("sys_hub_flow_x", record("sys_hub_flow", "a".repeat(32), { name: "Notify" }));
    const published = copy({ name: "Notify", status: "published" }, [], VERSION);
    const same = { build: unitDigest(flow), instance: VERSION, losses: [] };
    expect(planUnit(flow, unitDigest(flow), published, same)).toEqual({ kind: "none" });
    expect(planUnit(flow, unitDigest(flow), published, { ...same, build: "older" })).toMatchObject({
      kind: "load",
    });
  });
});
