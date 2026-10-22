import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type BuiltUnit, type FluentToolchain, InvalidRecordReferenceError } from "@snagentic/core";
import { WorkspaceAuthoring } from "../../src/adapters/fluent/workspace-authoring";
import { executeUseCase } from "../../src/registry/execute";
import { takeOver } from "../../src/registry/take-over";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const SHIPPED = "8aa1c7cd872413005087af1e36cb0bff";
const BUILT = "1f3b0c5e9a7d4e2f8b6c1d0e2f3a4b5c";
const KEYS = { name: "incident_task", view: "Default view", caption: "", sys_domain: "global" };

const section: BuiltUnit = {
  updateName: `sys_ui_section_${BUILT}`,
  file: `sys_ui_section_${BUILT}.xml`,
  head: {
    table: "sys_ui_section",
    sysId: BUILT,
    action: "INSERT_OR_UPDATE",
    fields: { sys_id: BUILT, ...KEYS, title: "true" },
    referenceNames: { view: "" },
  },
  children: [],
};

const runtime = async () => ({
  sdkVersion: "4.13.6",
  build: async () => ({ success: true as const, records: [] }),
  transform: async () => ({ success: false as const, message: "unused" }),
});

async function workspace(customized: boolean) {
  const ws = await instanceWorkspace({
    sys_ui_section: [
      {
        sys_id: SHIPPED,
        sys_class_name: "sys_ui_section",
        ...KEYS,
        title: "true",
        "view.name": "",
        sys_mod_count: "0",
        sys_updated_on: "2018-02-26 11:36:25",
        sys_update_name: `sys_ui_section_${SHIPPED}`,
      },
    ],
    sys_ui_element: [],
    sys_update_xml: customized
      ? [{ sys_id: "u".repeat(32), name: `sys_ui_section_${SHIPPED}` }]
      : [],
  });
  cleanups.push(ws.cleanup);
  await mkdir(join(ws.root, "source/global"), { recursive: true });
  await writeFile(
    join(ws.root, "source/global/now.config.json"),
    JSON.stringify({ scope: "global", scopeId: "global" }),
  );
  const toolchain: FluentToolchain = {
    build: async () => ({ ok: true, units: [section], files: new Map() }),
    draftTransform: async () => ({ ok: false, message: "unused" }),
  };
  const context = {
    ...ws.context,
    authoring: () => ({ workspace: new WorkspaceAuthoring(ws.root, runtime), toolchain }),
  };
  return { ...ws, context };
}

describe("take-over", () => {
  it("records an untouched layout in the project's ledger", async () => {
    const { context } = await workspace(false);
    const { output, exitCode } = await executeUseCase(
      takeOver,
      { instance: "pdi", records: [`sys_ui_section:${SHIPPED}`] },
      context,
    );
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      taken: [{ sysId: SHIPPED, updateName: `sys_ui_section_${BUILT}`, project: "source/global" }],
      customized: [],
    });
    expect(takeOver.render(output as never, "text")).toContain(
      `taken over sys_ui_section ${SHIPPED}`,
    );
  });

  it("refuses a customized layout, and exits non-zero", async () => {
    const { context } = await workspace(true);
    const { output, exitCode } = await executeUseCase(
      takeOver,
      { instance: "pdi", records: [`sys_ui_section:${SHIPPED}`] },
      context,
    );
    expect(exitCode).toBe(1);
    expect(takeOver.render(output as never, "text")).toContain("customized on the instance");
  });

  it("renders records already owned and those no source record matches", () => {
    const text = takeOver.render(
      {
        instance: "pdi",
        taken: [],
        owned: ["sys_ui_section_b"],
        customized: [],
        absent: [{ table: "sys_ui_form", sysId: "f" }],
      },
      "text",
    );
    expect(text.split("\n")).toEqual([
      "already this branch's: sys_ui_section_b",
      "refused sys_ui_form f: no record of the source matches it on the instance",
    ]);
  });

  it("refuses a record not named table:sys_id", async () => {
    const { context } = await workspace(false);
    await expect(
      executeUseCase(takeOver, { instance: "pdi", records: [SHIPPED] }, context),
    ).rejects.toBeInstanceOf(InvalidRecordReferenceError);
  });
});
