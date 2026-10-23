import { describe, expect, it } from "bun:test";
import {
  AdoptRecordsNotFoundError,
  AdoptRefusedError,
  AdoptStoreApplicationError,
  AdoptTransformFailedError,
  AdoptUnexplainedDifferenceError,
  adopt,
  type BuiltUnit,
  InvalidScopeNameError,
  NothingAdoptedError,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";
import { memoryToolchain, memoryWorkspace } from "../support/memory-authoring";
import { record, SCRIPT_INCLUDE_ID, scriptInclude, unit } from "./units";

const SCOPE_ID = "489da54ae67c4a3e9f1e1e4347e9119b";
const signal = new AbortController().signal;
const access = {
  host: "https://instance.example.com/",
  exchange: async () => ({ status: 500, contentType: "", text: "" }),
};

const instanceRecord = {
  sys_id: SCRIPT_INCLUDE_ID,
  sys_class_name: "sys_script_include",
  sys_scope: SCOPE_ID,
  sys_mod_count: "1",
  sys_updated_on: "2026-10-16 06:30:48",
  sys_domain: "global",
  active: "true",
  api_name: "x_2222332_s11.E2EUtil",
  caller_access: "",
  client_callable: "false",
  description: "Helpers for the E2E probe.",
  name: "E2EUtil",
};

const instance = (overrides: Record<string, string> = {}, scopeClass = "sys_app") =>
  fakeInstance({
    sys_script_include: [{ ...instanceRecord, ...overrides }],
    sys_scope: [{ sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: scopeClass }],
  });

const toolchain = (after: readonly BuiltUnit[], before: readonly BuiltUnit[] = []) =>
  memoryToolchain({ after, before });

describe("adopt (ADR-0031 item 3)", () => {
  it("scaffolds the scope's project, writes the source and records what the instance held", async () => {
    const fake = instance();
    const { workspace, ledgers, written } = memoryWorkspace();
    const tools = toolchain([scriptInclude("Helpers for the E2E probe.")]);
    const result = await adopt(
      { reader: fake.reader, workspace, toolchain: tools.chain, access, signal },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    expect(result.projects).toEqual([{ path: "source/x_2222332_s11", created: true }]);
    expect(result.units).toEqual([
      {
        project: "source/x_2222332_s11",
        updateName: `sys_script_include_${SCRIPT_INCLUDE_ID}`,
        table: "sys_script_include",
        losses: [],
        sets: [],
      },
    ]);
    expect(result.files).toEqual(["source/x_2222332_s11/src/fluent/generated/si.now.ts"]);
    expect(result.unmanaged).toEqual([]);
    expect([...written.keys()]).toEqual(["source/x_2222332_s11/src/fluent/generated/si.now.ts"]);
    expect(tools.asked).toEqual([
      {
        project: "source/x_2222332_s11",
        records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }],
      },
    ]);
    const entry = ledgers
      .get("source/x_2222332_s11")
      ?.get("pdi2")
      ?.get(`sys_script_include_${SCRIPT_INCLUDE_ID}`);
    expect(entry?.instance).toBe("1|2026-10-16 06:30:48");
  });

  it("accepts the SDK's known losses and records them", async () => {
    const job = (runDay: string) =>
      unit(
        "sysauto_script_job",
        record("sysauto_script", "a".repeat(32), { name: "Nightly", run_dayofweek: runDay }),
      );
    const fake = fakeInstance({
      sysauto_script: [
        {
          sys_id: "a".repeat(32),
          sys_class_name: "sysauto_script",
          sys_scope: SCOPE_ID,
          name: "Nightly",
          run_dayofweek: "",
        },
      ],
      sys_scope: [{ sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: "sys_app" }],
    });
    const { workspace } = memoryWorkspace();
    const result = await adopt(
      { reader: fake.reader, workspace, toolchain: toolchain([job("1")]).chain, access, signal },
      { instance: "pdi2", records: [{ table: "sysauto_script", sysId: "a".repeat(32) }] },
    );
    expect(result.units[0]?.losses).toEqual(["api-default"]);
    expect(result.units[0]?.sets).toEqual(["sysauto_script.run_dayofweek = 1"]);
  });

  it("writes nothing when the build would change what the instance holds", async () => {
    const { workspace, ledgers, written } = memoryWorkspace();
    const tools = toolchain([scriptInclude("Something the instance does not hold.")]);
    const adopting = adopt(
      { reader: instance().reader, workspace, toolchain: tools.chain, access, signal },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    await expect(adopting).rejects.toBeInstanceOf(AdoptUnexplainedDifferenceError);
    expect(written.size).toBe(0);
    expect(ledgers.size).toBe(0);
  });

  // Spec 012, B-19: a secret left empty in source showed the instance's value in the error.
  it("never shows a secret field's values in the differences it names", async () => {
    const built = scriptInclude("Helpers for the E2E probe.");
    const withSecret = {
      ...built,
      head: { ...built.head, fields: { ...built.head.fields, password: "" } },
    };
    const tools = toolchain([withSecret]);
    const error = await adopt(
      {
        reader: instance({ password: "s3cret-value" }).reader,
        workspace: memoryWorkspace().workspace,
        toolchain: tools.chain,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    ).catch((e: unknown) => e);
    const differences = error instanceof AdoptUnexplainedDifferenceError ? error.differences : [];
    expect(differences).toEqual([
      `sys_script_include_${SCRIPT_INCLUDE_ID}: sys_script_include.password would be [redacted], is [redacted]`,
    ]);
  });

  it("ledgers only the units the transform added or changed", async () => {
    const other = unit("sys_properties_x", record("sys_properties", "c".repeat(32), { name: "x" }));
    const { workspace, ledgers } = memoryWorkspace();
    const tools = toolchain([other, scriptInclude("Helpers for the E2E probe.")], [other]);
    await adopt(
      { reader: instance().reader, workspace, toolchain: tools.chain, access, signal },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    expect([...(ledgers.get("source/x_2222332_s11")?.get("pdi2")?.keys() ?? [])]).toEqual([
      `sys_script_include_${SCRIPT_INCLUDE_ID}`,
    ]);
  });

  it("refuses records the instance no longer holds, before converting anything", async () => {
    const tools = toolchain([]);
    const adopting = adopt(
      {
        reader: instance().reader,
        workspace: memoryWorkspace().workspace,
        toolchain: tools.chain,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_ui_list", sysId: "d".repeat(32) }] },
    );
    await expect(adopting).rejects.toBeInstanceOf(AdoptRecordsNotFoundError);
    expect(tools.asked).toEqual([]);
  });

  it("refuses records of an application installed from the store (S17 G4)", async () => {
    const adopting = adopt(
      {
        reader: instance({}, "sys_store_app").reader,
        workspace: memoryWorkspace().workspace,
        toolchain: toolchain([]).chain,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    await expect(adopting).rejects.toBeInstanceOf(AdoptStoreApplicationError);
  });

  it("refreshes as of the last ledger commit and merges into the working tree", async () => {
    const { workspace, projects, merged, written } = memoryWorkspace("c0ffee");
    projects.set("x_2222332_s11", {
      path: "source/x_2222332_s11",
      scope: "x_2222332_s11",
      scopeId: SCOPE_ID,
    });
    const tools = toolchain([scriptInclude("Helpers for the E2E probe.")]);
    const result = await adopt(
      { reader: instance().reader, workspace, toolchain: tools.chain, access, signal },
      {
        instance: "pdi2",
        records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }],
        refresh: true,
      },
    );
    expect(tools.asked).toEqual([
      {
        project: "source/x_2222332_s11",
        records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }],
        commit: "c0ffee",
      },
    ]);
    expect(merged).toEqual([
      {
        project: "source/x_2222332_s11",
        from: "c0ffee",
        files: ["src/fluent/generated/si.now.ts"],
      },
    ]);
    expect(written.size).toBe(0);
    expect(result.conflicts).toEqual([]);
  });

  it("refuses to refresh a project nothing was adopted into", async () => {
    const refreshing = adopt(
      {
        reader: instance().reader,
        workspace: memoryWorkspace().workspace,
        toolchain: toolchain([]).chain,
        access,
        signal,
      },
      {
        instance: "pdi2",
        records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }],
        refresh: true,
      },
    );
    await expect(refreshing).rejects.toBeInstanceOf(NothingAdoptedError);
  });

  it("names what it could not explain: a record the instance lacks, rows elsewhere, rows that differ", async () => {
    const list = (elements: readonly string[]) => ({
      updateName: "sys_ui_list_x_t_null",
      file: "sys_ui_list_x_t_null.xml",
      head: record(
        "sys_ui_list",
        "c".repeat(32),
        { name: "x_t", view: "Default view", sys_domain: "global" },
        { view: "NULL" },
      ),
      children: elements.map((element, i) =>
        record("sys_ui_list_element", `${i}`.padStart(32, "e"), {
          list_id: "c".repeat(32),
          element,
          position: String(i),
        }),
      ),
    });
    const fake = fakeInstance({
      sys_script_include: [{ ...instanceRecord }],
      sys_scope: [{ sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: "sys_app" }],
      sys_ui_list: [
        {
          sys_id: "c".repeat(32),
          name: "x_t",
          view: "Default view",
          "view.name": "",
          sys_domain: "global",
        },
      ],
      sys_ui_list_element: [
        {
          sys_id: "1".repeat(32),
          list_id: "c".repeat(32),
          element: "state",
          position: "0",
          sys_domain: "global",
        },
      ],
    });
    const missing = scriptInclude("Helpers for the E2E probe.");
    const absent = {
      ...missing,
      updateName: "sys_script_include_x",
      head: { ...missing.head, sysId: "9".repeat(32) },
    };
    const adopting = adopt(
      {
        reader: fake.reader,
        workspace: memoryWorkspace().workspace,
        toolchain: toolchain([absent, list(["number"])]).chain,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    const error = await adopting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdoptUnexplainedDifferenceError);
    const differences = error instanceof AdoptUnexplainedDifferenceError ? error.differences : [];
    expect(differences).toEqual([
      "sys_script_include_x: the build makes a record the instance does not hold",
      "sys_ui_list_x_t_null: sys_ui_list_element rows would be [number], are [state]",
    ]);

    fake.tables["sys_ui_list_element"]?.push({
      sys_id: "2".repeat(32),
      list_id: "c".repeat(32),
      element: "number",
      position: "0",
      sys_domain: "d1",
    });
    const elsewhere = await adopt(
      {
        reader: fake.reader,
        workspace: memoryWorkspace().workspace,
        toolchain: toolchain([list(["state"])]).chain,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    ).catch((e: unknown) => e);
    expect(
      elsewhere instanceof AdoptUnexplainedDifferenceError ? elsewhere.differences : [],
    ).toEqual(["sys_ui_list_x_t_null: 1 of its rows are in a domain the SDK would not keep"]);
  });

  it("refuses when the SDK cannot convert the records", async () => {
    const failing = {
      ...toolchain([]).chain,
      draftTransform: async () => ({ ok: false as const, message: "Record not found" }),
    };
    const adopting = adopt(
      {
        reader: instance().reader,
        workspace: memoryWorkspace().workspace,
        toolchain: failing,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    await expect(adopting).rejects.toBeInstanceOf(AdoptTransformFailedError);
  });

  it("names a conversion the SDK can't make as a refusal, with what to set", async () => {
    const failing = {
      ...toolchain([]).chain,
      draftTransform: async () => ({
        ok: false as const,
        message: "Cannot coerce value to number: ",
      }),
    };
    const adopting = adopt(
      {
        reader: instance().reader,
        workspace: memoryWorkspace().workspace,
        toolchain: failing,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    await expect(adopting).rejects.toBeInstanceOf(AdoptRefusedError);
  });

  it("refuses what the conversion fixes refuse, with their reasons", async () => {
    const reason = "ua.now.ts: a role the SDK's conversion couldn't read";
    const failing = {
      ...toolchain([]).chain,
      draftTransform: async () => ({ ok: false as const, message: reason, refused: [reason] }),
    };
    const adopting = adopt(
      {
        reader: instance().reader,
        workspace: memoryWorkspace().workspace,
        toolchain: failing,
        access,
        signal,
      },
      { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
    );
    const refused = await adopting.catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AdoptRefusedError);
    expect(refused instanceof AdoptRefusedError ? refused.message : "").toContain(reason);
  });

  it("adopts each scope's records into its own project, in scope order", async () => {
    const OTHER = "b".repeat(32);
    const fake = fakeInstance({
      sys_script_include: [{ ...instanceRecord }],
      sys_properties: [
        { sys_id: "c".repeat(32), sys_class_name: "sys_properties", sys_scope: OTHER, name: "x.y" },
      ],
      sys_scope: [
        { sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: "sys_app" },
        { sys_id: OTHER, scope: "x_2222332_aaa", sys_class_name: "sys_app" },
      ],
    });
    const result = await adopt(
      {
        reader: fake.reader,
        workspace: memoryWorkspace().workspace,
        toolchain: toolchain([]).chain,
        access,
        signal,
      },
      {
        instance: "pdi2",
        records: [
          { table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID },
          { table: "sys_properties", sysId: "c".repeat(32) },
        ],
      },
    );
    expect(result.projects.map((p) => p.path)).toEqual([
      "source/x_2222332_aaa",
      "source/x_2222332_s11",
    ]);
    expect(result.unmanaged).toEqual([
      `sys_properties:${"c".repeat(32)}`,
      `sys_script_include:${SCRIPT_INCLUDE_ID}`,
    ]);
  });

  it.each(["../../outside", "x_app/../../outside", "X App", ""])(
    "refuses a scope name that is not a ServiceNow scope, writing nothing (%p)",
    async (scope) => {
      const fake = fakeInstance({
        sys_script_include: [instanceRecord],
        sys_scope: [{ sys_id: SCOPE_ID, scope, sys_class_name: "sys_app" }],
      });
      const { workspace, written } = memoryWorkspace();
      const adopting = adopt(
        {
          reader: fake.reader,
          workspace,
          toolchain: toolchain([scriptInclude("Helpers for the E2E probe.")]).chain,
          access,
          signal,
        },
        { instance: "pdi2", records: [{ table: "sys_script_include", sysId: SCRIPT_INCLUDE_ID }] },
      );
      await expect(adopting).rejects.toBeInstanceOf(InvalidScopeNameError);
      expect(written.size).toBe(0);
    },
  );

  it("refuses by design, naming why, a protected role whose containments the SDK would protect", async () => {
    const id = "c".repeat(32);
    const fake = fakeInstance({
      sys_user_role_contains: [
        {
          sys_id: id,
          sys_class_name: "sys_user_role_contains",
          sys_scope: SCOPE_ID,
          sys_policy: "",
          sys_mod_count: "0",
          sys_updated_on: "2026-10-16 06:30:48",
        },
      ],
      sys_scope: [{ sys_id: SCOPE_ID, scope: "x_2222332_s11", sys_class_name: "sys_app" }],
    });
    const contains = unit(
      `sys_user_role_contains_${id}`,
      record("sys_user_role_contains", id, { sys_id: id, sys_policy: "read" }),
    );
    const { workspace, written } = memoryWorkspace();
    const adopting = adopt(
      { reader: fake.reader, workspace, toolchain: toolchain([contains]).chain, access, signal },
      { instance: "pdi2", records: [{ table: "sys_user_role_contains", sysId: id }] },
    );
    await expect(adopting).rejects.toBeInstanceOf(AdoptRefusedError);
    await expect(adopting).rejects.toThrow("containment rows' protection from none to read");
    expect(written.size).toBe(0);
  });
});
