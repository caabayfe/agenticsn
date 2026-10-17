import { describe, expect, it } from "bun:test";
import {
  describeRecord,
  describeTable,
  type KnowledgeDependencies,
  type RecordFields,
  refreshIndex,
} from "@snagentic/core";
import { memoryMirror, memoryStore, record } from "../support/memory-knowledge";

const PROTECTED = "global/sys_script_include/licensed-helper--p1";
const INBOUND = "global/sysevent_in_email_action/create-incident--e1";
const FLOW = "global/sys_hub_flow/sync-tickets--f1";
const PLAIN = "global/sys_script_include/plain--s1";

const FILES: Record<string, RecordFields> = {
  [`${PROTECTED}.yaml`]: record("sys_script_include", "p1", {
    name: "LicensedHelper",
    sys_policy: "protected",
  }),
  [`${INBOUND}.yaml`]: record("sysevent_in_email_action", "e1", {
    name: "Create incident",
    table: "incident",
  }),
  [`${FLOW}.yaml`]: record("sys_hub_flow", "f1", { name: "Sync tickets" }),
  // The flow's input that takes a connection alias: it names the flow as its model.
  "global/sys_hub_flow_input/var-m-input--i1.yaml": record("sys_hub_flow_input", "i1", {
    name: "var__m_sys_hub_flow_input_f1",
    element: "connection",
    model: "f1",
    reference: "sys_alias",
  }),
  [`${PLAIN}.yaml`]: record("sys_script_include", "s1", { name: "Plain" }),
  "global/sys_script/protected-rule--b1.yaml": record("sys_script", "b1", {
    name: "Licensed rule",
    collection: "incident",
    when: "before",
    sys_policy: "protected",
  }),
};

async function deps(files: Record<string, RecordFields> = FILES): Promise<KnowledgeDependencies> {
  const store = memoryStore();
  const { mirror } = memoryMirror(files);
  await refreshIndex(store, mirror);
  return {
    store,
    files: mirror,
    catalog: { parents: { incident: "task", task: null }, scopes: {}, typedFields: {} },
    asOf: "2026-10-06 10:00:00",
    now: () => new Date("2026-10-06T12:00:00Z"),
  };
}

const withEmailSwitch = (value: string): Record<string, RecordFields> => ({
  ...FILES,
  "global/sys_properties/glide-email-read-active--g1.yaml": record("sys_properties", "g1", {
    name: "glide.email.read.active",
    type: "boolean",
    value,
  }),
});

// ADR-0034 #3: what the mirror leaves out on purpose is named, not left for the agent to guess.
describe("describe: what the mirror leaves out", () => {
  it("says a protected script include's code is not readable", async () => {
    const described = await describeRecord(await deps(), PROTECTED);
    expect(described.notMirrored).toEqual([expect.stringContaining("protected by the platform")]);
  });

  it("says mail accounts are not mirrored when describing an inbound email action", async () => {
    const described = await describeRecord(await deps(), INBOUND);
    expect(described.notMirrored).toContainEqual(expect.stringContaining("sys_email_account"));
  });

  it("gives the value of the switch that turns email receiving on, when the mirror has it", async () => {
    const described = await describeRecord(await deps(withEmailSwitch("false")), INBOUND);
    expect(described.notMirrored).toContainEqual(
      expect.stringContaining("glide.email.read.active is false"),
    );
  });

  it("says the switch's value is unknown when the mirror doesn't hold it", async () => {
    const described = await describeRecord(await deps(), INBOUND);
    expect(described.notMirrored).toContainEqual(
      expect.stringContaining("glide.email.read.active is not in the mirror"),
    );
  });

  it("says connection aliases are not mirrored when describing a flow that maps one", async () => {
    const described = await describeRecord(await deps(), FLOW);
    expect(described.notMirrored).toEqual([expect.stringContaining("sys_alias")]);
  });

  it("lists no omission for a record they don't concern", async () => {
    const described = await describeRecord(await deps(), PLAIN);
    expect(described.notMirrored).toEqual([]);
  });

  it("names a table's behavior whose code is protected", async () => {
    const table = await describeTable(await deps(), "incident");
    expect(table.notCovered).toContainEqual(
      expect.stringContaining("1 business rule or script on this table is protected"),
    );
  });
});
