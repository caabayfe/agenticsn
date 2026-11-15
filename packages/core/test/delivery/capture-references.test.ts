import { describe, expect, it } from "bun:test";
import { type BuiltUnit, capturedContentAgrees, type UnitRecord } from "@snagentic/core";
import { captureReferences } from "../../src/delivery/application/capture-references";
import { fakeInstance } from "../support/fake-instance";

const HEAD = "a".repeat(32);
const PARENT = "b".repeat(32);
const SNAPSHOT = "c".repeat(32);
const signal = new AbortController().signal;
const record = (table: string, sysId: string, fields: Record<string, string>): UnitRecord => ({
  table,
  sysId,
  fields,
  action: "INSERT_OR_UPDATE",
  referenceNames: {},
});
const unit = (children: readonly UnitRecord[]): BuiltUnit => ({
  updateName: `sys_hub_flow_${HEAD}`,
  file: "flow.xml",
  head: record("sys_hub_flow", HEAD, { name: "P1" }),
  children,
});

describe("captured compiled references", () => {
  it("resolves action and subflow snapshots to their definition IDs through indexed reads", async () => {
    const built = unit([
      record("sys_hub_action_instance_v2", "1".repeat(32), { action_type: PARENT }),
      record("sys_hub_sub_flow_instance_v2", "2".repeat(32), { subflow: PARENT }),
    ]);
    const held = unit([
      record("sys_hub_action_instance_v2", "1".repeat(32), { action_type: SNAPSHOT }),
      record("sys_hub_sub_flow_instance_v2", "2".repeat(32), { subflow: "d".repeat(32) }),
    ]);
    const fake = fakeInstance({
      sys_hub_action_type_snapshot: [{ sys_id: SNAPSHOT, parent_action: PARENT }],
      sys_hub_flow_snapshot: [{ sys_id: "d".repeat(32), parent_flow: PARENT }],
    });
    const references = await captureReferences(fake.reader, built, held, signal);
    expect(references.size).toBe(2);
    expect(capturedContentAgrees(built, held, references)).toBe(true);
    expect(capturedContentAgrees(built, held)).toBe(false);
  });

  it("leaves missing, inaccessible and malformed snapshot parents unverified", async () => {
    const built = unit([record("sys_hub_action_instance_v2", HEAD, { action_type: PARENT })]);
    for (const value of [SNAPSHOT, "bad^query", ""]) {
      const held = unit([record("sys_hub_action_instance_v2", HEAD, { action_type: value })]);
      const fake = fakeInstance({
        sys_hub_action_type_snapshot: [{ sys_id: SNAPSHOT, parent_action: "" }],
      });
      const references = await captureReferences(fake.reader, built, held, signal);
      expect(references.size).toBe(0);
      expect(capturedContentAgrees(built, held, references)).toBe(false);
    }
  });

  it("does not resolve an unchanged definition reference or a missing captured row", async () => {
    const built = unit([
      record("sys_hub_action_instance_v2", HEAD, { action_type: PARENT }),
      record("sys_hub_flow_input", "i", { element: "x" }),
    ]);
    const fake = fakeInstance({});
    expect((await captureReferences(fake.reader, built, built, signal)).size).toBe(0);
    expect((await captureReferences(fake.reader, built, unit([]), signal)).size).toBe(0);
  });

  it("batches large reference graphs without offset pagination", async () => {
    const snapshots = Array.from({ length: 101 }, (_, i) => ({
      sys_id: (i + 1000).toString(16).padStart(32, "0"),
      parent_action: PARENT,
    }));
    const children = snapshots.map((row, i) =>
      record("sys_hub_action_instance_v2", String(i), { action_type: row.sys_id }),
    );
    const built = unit(children.map((row) => ({ ...row, fields: { action_type: PARENT } })));
    const references = await captureReferences(
      fakeInstance({ sys_hub_action_type_snapshot: snapshots }).reader,
      built,
      unit(children),
      signal,
    );
    expect(references.size).toBe(101);
  });
});
