import { expect, it } from "bun:test";
import {
  type BuiltUnit,
  type CaptureDecoder,
  computeUnitPlan,
  type InstanceCopy,
  InstanceError,
  type PendingDelivery,
  pushUnits,
  type UnitRecord,
  unitDigest,
} from "@snagentic/core";
import { reconcilePending } from "../../src/delivery/application/reconcile-pending";
import { fakeInstance } from "../support/fake-instance";
import { QUERY, unitSetup } from "./unit-fixture";

const ID = "a".repeat(32);
const STEP = "b".repeat(32);
const record = (table: string, sysId: string, fields: Record<string, string>): UnitRecord => ({
  table,
  sysId,
  action: "INSERT_OR_UPDATE",
  fields: { sys_id: sysId, ...fields },
  referenceNames: {},
});

function fixture() {
  const unit: BuiltUnit = {
    updateName: `sys_hub_flow_${ID}`,
    file: "flow.xml",
    head: record("sys_hub_flow", ID, {
      name: "Owned new flow",
      status: "draft",
      active: "false",
      type: "flow",
    }),
    children: [
      record("sys_hub_action_instance_v2", STEP, { flow: ID, values: '{"script":"reviewed"}' }),
    ],
  };
  const head = {
    ...unit.head.fields,
    master_snapshot: "",
    latest_snapshot: "",
    sys_mod_count: "0",
    sys_updated_on: "2026-11-17 13:38:09",
    sys_domain: "global",
  };
  const captured: BuiltUnit = { ...unit, head: { ...unit.head, fields: head } };
  const copy: InstanceCopy = {
    head,
    children: [],
    version: "0|2026-11-17 13:38:09",
    foreignRows: 0,
  };
  const receipt: PendingDelivery = {
    project: "source/global",
    updateName: unit.updateName,
    digest: unitDigest(unit),
    updateSet: "original-set",
    before: null,
    operation: "create",
    removes: null,
  };
  const tables = {
    sys_update_xml: [
      { sys_id: "capture", name: unit.updateName, update_set: "original-set", payload: "draft" },
    ],
    sys_hub_flow: [head],
    sys_hub_action_instance_v2: [unit.children[0]?.fields ?? {}],
  };
  const denied: string[] = [];
  const native = fakeInstance(tables, denied);
  const { reader } = native;
  const decode: CaptureDecoder = (_name, payload, live) =>
    payload === "draft" ? { unit: captured, published: false, ...(live ? { live } : {}) } : null;
  const run = (pending = receipt, wanted = unit, remote = copy, decoder = decode) =>
    reconcilePending(reader, wanted, pending, remote, decoder, new AbortController().signal, {
      allowDraftLoad: true,
    });
  return { unit, captured, copy, receipt, tables, native, denied, reader, decode, run };
}

it("plans an explicit reload of a new captured draft only after independently matching its live graph", async () => {
  const c = fixture();
  expect(await c.run()).toEqual({ ...c.receipt, observed: c.copy.version });
  expect(c.receipt.observed).toBeUndefined();
  expect((await c.run()).verified).not.toBe(true);
});

it("keeps receipt-only recovery strict and never records an unpublished draft", async () => {
  const c = fixture();
  expect(
    await reconcilePending(
      c.reader,
      c.unit,
      c.receipt,
      c.copy,
      c.decode,
      new AbortController().signal,
    ),
  ).toEqual(c.receipt);
});

it("refuses a stale capture when an authored live child was changed without updating the head", async () => {
  const c = fixture();
  c.tables.sys_hub_action_instance_v2 = [
    { ...c.unit.children[0]?.fields, sys_id: STEP, values: '{"script":"external"}' },
  ];
  expect(await c.run()).toEqual(c.receipt);
});

it("refuses an unexpected live action absent from both the reviewed build and original capture", async () => {
  const c = fixture();
  c.tables.sys_hub_action_instance_v2.push({ sys_id: "c".repeat(32), flow: ID, values: "{}" });
  expect(await c.run()).toEqual(c.receipt);
});

for (const [name, changes] of Object.entries({
  "a prior record": { before: "older" },
  "a known observed write": { observed: "older" },
  "an update of an existing flow": { operation: "load" as const },
  "a previously verified receipt": { verified: true },
  "a changed source digest": { digest: "different" },
})) {
  it(`does not infer new-draft ownership for ${name}`, async () => {
    const c = fixture();
    const pending: PendingDelivery = { ...c.receipt, ...changes };
    expect(await c.run(pending)).toEqual(pending);
  });
}

for (const [name, fields] of Object.entries({
  "an active draft": { active: "true" },
  "a published flow": { status: "published" },
  "another domain": { sys_domain: "other" },
  "a master snapshot": { master_snapshot: "c".repeat(32) },
  "a latest snapshot absent from the initial head read": { latest_snapshot: "c".repeat(32) },
  "an external head edit": { name: "External" },
  "a changed head version": { sys_mod_count: "9" },
})) {
  it(`refuses ${name} despite an unchanged original capture`, async () => {
    const c = fixture();
    c.native.tables["sys_hub_flow"] = c.tables.sys_hub_flow.map((row) => ({ ...row, ...fields }));
    expect(await c.run()).toEqual(c.receipt);
  });
}

it("reads runtime families absent from the build and capture, rejecting an extra live branch", async () => {
  const c = fixture();
  c.native.tables["sys_hub_flow_logic_instance_v2"] = [{ sys_id: "c".repeat(32), flow: ID }];
  expect(await c.run()).toEqual(c.receipt);
});

it("reads aliases owned by a child action and rejects an unexpected mapping", async () => {
  const c = fixture();
  c.native.tables["sys_hub_alias_mapping"] = [{ sys_id: "c".repeat(32), source_id: STEP }];
  expect(await c.run()).toEqual(c.receipt);
});

it("compares a raw SLA draft before publication creates runtime trigger rows", async () => {
  const c = fixture();
  const trigger = record("sys_hub_trigger_instance_v2", "c".repeat(32), {
    flow: ID,
    trigger_type: "sla_task",
    trigger_definition: "d".repeat(32),
    trigger_inputs: "{}",
  });
  const unit = { ...c.unit, children: [...c.unit.children, trigger] };
  const captured = { ...c.captured, children: unit.children };
  c.native.tables["sys_hub_trigger_instance_v2"] = [trigger.fields];
  const pending = { ...c.receipt, digest: unitDigest(unit) };
  const decode: CaptureDecoder = (_name, _payload, live) => ({
    unit: captured,
    published: false,
    ...(live ? { live } : {}),
  });
  expect(await c.run(pending, unit, c.copy, decode)).toEqual({
    ...pending,
    observed: c.copy.version,
  });
});

it("refuses publication-generated input rows that appeared in a supposedly raw draft", async () => {
  const c = fixture();
  c.native.tables["sys_hub_flow_input"] = [
    { sys_id: "c".repeat(32), model: ID, element: "current" },
  ];
  expect(await c.run()).toEqual(c.receipt);
});

it("verifies subflow input documentation through its exact owned model name", async () => {
  const c = fixture();
  const name = `var__m_sys_hub_flow_input_${ID}`;
  const input = record("sys_hub_flow_input", "c".repeat(32), {
    model: ID,
    name,
    element: "caller",
  });
  const doc = record("sys_documentation", "d".repeat(32), {
    name,
    element: "caller",
    label: "Caller",
  });
  const unit = { ...c.unit, children: [...c.unit.children, input, doc] };
  const captured = { ...c.captured, children: unit.children };
  c.native.tables["sys_hub_flow_input"] = [input.fields];
  c.native.tables["sys_documentation"] = [doc.fields];
  const pending = { ...c.receipt, digest: unitDigest(unit) };
  const decode: CaptureDecoder = (_name, _payload, live) => ({
    unit: captured,
    published: false,
    ...(live ? { live } : {}),
  });
  expect(await c.run(pending, unit, c.copy, decode)).toEqual({
    ...pending,
    observed: c.copy.version,
  });
  expect(
    c.native.queries.some(
      (query) => query.table === "sys_documentation" && query.query.startsWith(`nameIN${name}`),
    ),
  ).toBe(true);
});

it("refuses documentation bound to another flow even when source and capture agree", async () => {
  const c = fixture();
  const doc = record("sys_documentation", "d".repeat(32), {
    name: `var__m_sys_hub_flow_input_${"e".repeat(32)}`,
  });
  const unit = { ...c.unit, children: [...c.unit.children, doc] };
  const captured = { ...c.captured, children: unit.children };
  const pending = { ...c.receipt, digest: unitDigest(unit) };
  const decode: CaptureDecoder = (_name, _payload, live) => ({
    unit: captured,
    published: false,
    ...(live ? { live } : {}),
  });
  expect(await c.run(pending, unit, c.copy, decode)).toEqual(pending);
});

it("refuses a missing original capture", async () => {
  const c = fixture();
  c.tables.sys_update_xml = [];
  expect(await c.run()).toEqual(c.receipt);
});

it("propagates an unreadable live graph and preserves its receipt", async () => {
  const c = fixture();
  c.denied.push("sys_hub_action_instance_v2");
  await expect(c.run()).rejects.toMatchObject({ code: "access-denied" });
  expect(c.receipt.observed).toBeUndefined();
});

it("refuses an unsupported child ownership shape even when the capture and build agree", async () => {
  const c = fixture();
  const unit = { ...c.unit, children: [record("unknown_flow_child", STEP, { flow: ID })] };
  const captured = { ...c.captured, children: unit.children };
  const pending = { ...c.receipt, digest: unitDigest(unit) };
  const decode: CaptureDecoder = (_name, _payload, live) => ({
    unit: captured,
    published: false,
    ...(live ? { live } : {}),
  });
  expect(await c.run(pending, unit, c.copy, decode)).toEqual(pending);
});

it("refuses a head changed while the live graph is being read", async () => {
  const c = fixture();
  const query = c.reader.query;
  c.reader.query = async (...args) => {
    const rows = await query(...args);
    if (args[0].table === "sys_hub_action_instance_v2") {
      c.native.tables["sys_hub_flow"] = c.tables.sys_hub_flow.map((row) => ({
        ...row,
        sys_mod_count: "9",
      }));
    }
    return rows;
  };
  expect(await c.run()).toEqual(c.receipt);
});

it("bounds extra owned rows rather than scanning an unbounded graph", async () => {
  const c = fixture();
  c.native.tables["sys_hub_action_instance_v2"] = Array.from({ length: 1100 }, (_, n) => ({
    sys_id: n.toString(16).padStart(32, "0"),
    flow: ID,
  }));
  expect(await c.run()).toEqual(c.receipt);
  expect(c.native.queries.length).toBeLessThan(10);
});

it("requires a new approved load after a timed-out new flow and commits only after publication and capture verification", async () => {
  const c = unitSetup({ ledger: null });
  const unit = fixture().unit;
  c.builds.set(c.project.path, [unit]);
  c.xml.set(
    unit.updateName,
    `<record_update table="sys_hub_flow"><sys_hub_flow action="INSERT_OR_UPDATE"><sys_id>${ID}</sys_id><status>draft</status></sys_hub_flow></record_update>`,
  );
  const original = c.deps.installer.load;
  let timeout = true;
  const deps = {
    ...c.deps,
    decodeCapture: (_name: string, payload: string, live?: InstanceCopy | null) => {
      const content = c.payloads.get(payload);
      return content === undefined ? null : { ...content, ...(live === undefined ? {} : { live }) };
    },
    installer: {
      ...c.deps.installer,
      load: async (...args: Parameters<typeof original>) => {
        await original(...args);
        c.tables["sys_hub_flow"] = (c.tables["sys_hub_flow"] ?? []).map((row) => ({
          ...row,
          sys_domain: "global",
          master_snapshot: "",
          latest_snapshot: "",
        }));
        c.tables["sys_hub_action_instance_v2"] = unit.children.map((row) => row.fields);
        for (const [key, payload] of c.payloads) {
          if (payload.unit.updateName !== unit.updateName) continue;
          c.payloads.set(key, {
            ...payload,
            unit: {
              ...payload.unit,
              head: { ...payload.unit.head, fields: c.tables["sys_hub_flow"]?.[0] ?? {} },
            },
          });
        }
        if (timeout) {
          timeout = false;
          throw new InstanceError("native load completed after the client timeout");
        }
      },
    },
  };
  const initial = (await computeUnitPlan(deps, QUERY)).plan;
  await expect(
    pushUnits(deps, { ...QUERY, planId: initial.planId, confirm: true }),
  ).rejects.toMatchObject({ code: "instance-error" });
  const receipt = await c.journal.read();
  expect(c.calls.filter((call) => call.startsWith("publish"))).toHaveLength(0);
  expect((await computeUnitPlan(deps, { ...QUERY, recoverPending: true })).plan.ready).toBe(false);
  const plan = (await computeUnitPlan(deps, QUERY)).plan;
  expect(plan).toMatchObject({
    ready: true,
    units: [{ updateName: unit.updateName, operation: "load" }],
  });
  expect(await c.journal.read()).toEqual(receipt);
  await expect(
    pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: false }),
  ).rejects.toMatchObject({ code: "push-confirmation-required" });
  const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
  expect(result).toMatchObject({ notCaptured: 0, notApplied: 0 });
  expect(c.calls.filter((call) => call.startsWith("publish"))).toHaveLength(1);
  expect(await c.journal.read()).toBeNull();
});
