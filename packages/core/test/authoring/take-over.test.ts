import { describe, expect, it } from "bun:test";
import { type Row, TakeOverBuildFailedError, takeOver } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";
import { memoryToolchain, memoryWorkspace } from "../support/memory-authoring";
import { record, unit } from "./units";

// The incident task form's main section as pdi2 ships it, and the module's own build of it:
// Form() gives the section its own sys_id, and the platform matches it on name, view, caption
// and domain.
const SHIPPED = "8aa1c7cd872413005087af1e36cb0bff";
const BUILT = "1f3b0c5e9a7d4e2f8b6c1d0e2f3a4b5c";
const UPDATE_NAME = `sys_ui_section_${SHIPPED}`;
const signal = new AbortController().signal;

const section = unit(
  `sys_ui_section_${BUILT}`,
  record(
    "sys_ui_section",
    BUILT,
    {
      sys_id: BUILT,
      name: "incident_task",
      view: "Default view",
      caption: "",
      sys_domain: "global",
      title: "true",
      header: "false",
    },
    { view: "" },
  ),
);

const shippedRow: Row = {
  sys_id: SHIPPED,
  sys_class_name: "sys_ui_section",
  name: "incident_task",
  view: "Default view",
  caption: "",
  sys_domain: "global",
  title: "true",
  header: "false",
  sys_mod_count: "0",
  sys_updated_on: "2018-02-26 11:36:25",
  sys_update_name: UPDATE_NAME,
  // The Default view's name is empty; the platform matches a layout's view by name.
  "view.name": "",
};

function setup(rows: Readonly<Record<string, readonly Row[]>>) {
  const fake = fakeInstance({ sys_ui_section: [shippedRow], sys_ui_element: [], ...rows });
  const { workspace, ledgers, add } = memoryWorkspace();
  const project = add("global", "global");
  const tools = memoryToolchain({ builds: new Map([[project.path, [section]]]) });
  const deps = { reader: fake.reader, workspace, toolchain: tools.chain, signal };
  return { deps, ledgers, project };
}

const asked = [{ table: "sys_ui_section", sysId: SHIPPED }];

describe("taking over an out-of-box record (ADR-0038 item 8)", () => {
  it("records an untouched shipped record as this branch's, so the next plan loads the module's layout over it", async () => {
    const { deps, ledgers } = setup({ sys_update_xml: [] });
    const result = await takeOver(deps, { instance: "pdi2", records: asked });
    expect(result.taken).toEqual([
      {
        table: "sys_ui_section",
        sysId: SHIPPED,
        updateName: `sys_ui_section_${BUILT}`,
        project: "source/global",
      },
    ]);
    expect(result.customized).toEqual([]);
    const entry = ledgers.get("source/global")?.get("pdi2")?.get(`sys_ui_section_${BUILT}`);
    // No build agreed with the instance yet: the plan compares and loads.
    expect(entry).toEqual({ build: "", instance: "0|2018-02-26 11:36:25", losses: [] });
  });

  it("refuses a record the client customized, and writes nothing", async () => {
    const { deps, ledgers } = setup({
      sys_update_xml: [{ sys_id: "u".repeat(32), name: UPDATE_NAME }],
    });
    const result = await takeOver(deps, { instance: "pdi2", records: asked });
    expect(result.taken).toEqual([]);
    expect(result.customized).toEqual([
      { table: "sys_ui_section", sysId: SHIPPED, updateName: UPDATE_NAME, project: "" },
    ]);
    expect(ledgers.get("source/global")).toBeUndefined();
  });

  it("takes over a customized record whose source restates it as it is now (form_field, D1)", async () => {
    const { deps, ledgers } = setup({
      sys_update_xml: [{ sys_id: "u".repeat(32), name: UPDATE_NAME }],
    });
    const result = await takeOver(deps, { instance: "pdi2", records: asked, restated: asked });
    expect(result.customized).toEqual([]);
    expect(result.taken).toMatchObject([{ sysId: SHIPPED, project: "source/global" }]);
    expect(ledgers.get("source/global")?.get("pdi2")?.has(`sys_ui_section_${BUILT}`)).toBe(true);
  });

  it("names a record no unit of the build makes as absent", async () => {
    const { deps } = setup({ sys_update_xml: [] });
    const other = { table: "sys_ui_section", sysId: "9".repeat(32) };
    const result = await takeOver(deps, { instance: "pdi2", records: [...asked, other] });
    expect(result.absent).toEqual([other]);
  });

  it("leaves a record the ledger already holds as this branch's", async () => {
    const { deps } = setup({ sys_update_xml: [] });
    await takeOver(deps, { instance: "pdi2", records: asked });
    const again = await takeOver(deps, { instance: "pdi2", records: asked });
    expect(again.taken).toEqual([]);
    expect(again.owned).toEqual([`sys_ui_section_${BUILT}`]);
  });
});

describe("taking over when the source does not build", () => {
  it("refuses with what to run, writing nothing", async () => {
    const fake = fakeInstance({ sys_ui_section: [shippedRow] });
    const { workspace, add } = memoryWorkspace();
    add("global", "global");
    const chain = {
      build: async () => ({ ok: false as const, message: "fluent250" }),
      draftTransform: async () => ({ ok: false as const, message: "" }),
    };
    await expect(
      takeOver(
        { reader: fake.reader, workspace, toolchain: chain, signal },
        { instance: "pdi2", records: asked },
      ),
    ).rejects.toBeInstanceOf(TakeOverBuildFailedError);
  });
});
