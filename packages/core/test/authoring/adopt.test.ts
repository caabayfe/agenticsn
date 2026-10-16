import { describe, expect, it } from "bun:test";
import {
  AdoptRecordsNotFoundError,
  AdoptStoreApplicationError,
  AdoptUnexplainedDifferenceError,
  type AuthoringWorkspace,
  adopt,
  type BuiltUnit,
  EMPTY_LEDGER,
  type FluentToolchain,
  type Ledger,
  NothingAdoptedError,
  type SourceProject,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";
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

function memoryWorkspace(base: string | null = null) {
  const projects = new Map<string, SourceProject>();
  const ledgers = new Map<string, Ledger>();
  const written = new Map<string, string>();
  const merged: unknown[] = [];
  const workspace: AuthoringWorkspace = {
    project: async (scope) => projects.get(scope) ?? null,
    scaffold: async ({ name, sysId }) => {
      const project = { path: `source/${name}`, scope: name, scopeId: sysId };
      projects.set(name, project);
      return project;
    },
    readLedger: async (project) => ledgers.get(project.path) ?? EMPTY_LEDGER,
    writeLedger: async (project, ledger) => {
      ledgers.set(project.path, ledger);
    },
    writeFiles: async (project, files) => {
      for (const [path, text] of files) written.set(`${project.path}/${path}`, text);
    },
    ledgerCommit: async () => base,
    mergeFiles: async (project, from, files) => {
      merged.push({ project: project.path, from, files: [...files.keys()] });
      return [];
    },
  };
  return { workspace, projects, ledgers, written, merged };
}

// A toolchain whose transform turns the project's build from `before` into `after`.
function toolchain(after: readonly BuiltUnit[], before: readonly BuiltUnit[] = []) {
  const asked: unknown[] = [];
  const chain: FluentToolchain = {
    draftTransform: async (project, records, _access, commit) => {
      asked.push({ project: project.path, records, ...(commit === undefined ? {} : { commit }) });
      const files = new Map([["src/fluent/generated/si.now.ts", "ScriptInclude({})"]]);
      return { ok: true, draft: { before, after, files } };
    },
  };
  return { chain, asked };
}

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
});
