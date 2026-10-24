import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  type InventoryReader,
  installPack,
  installPlanDocument,
  type PackWorkspace,
  planInstall,
  type SchemaReader,
} from "@snagentic/core";
import { fakeSteps, memoryJournal } from "../support/install-fakes";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// A fresh instance (pdi3) lacks the fields a plugin brings until the install activates it: such a
// field is checked again after the activation, not a reason to refuse the plan (spec 011, §15).

const MIM = "com.snc.incident.mim";

const PACK: PackFixture = {
  pack: { id: "itsm", version: "0.1.0", requires: { snagentic: ">=2.6.0" } },
  modules: {
    "major-incident": {
      label: "ITSM: major incident",
      components: [{ kind: "plugin", id: MIM }],
      fields: [
        { field: "incident.major_incident_state", from: MIM },
        { field: "incident.parent_incident", from: "com.snc.incident" },
        { field: "incident.u_mystery" },
      ],
      data: [
        {
          entity: "contact",
          table: "u_acc_imp_contact",
          target: "comm_contact_definition",
          // The table arrives with MIM: every column's field comes from it.
          from: MIM,
          key: ["plan"],
          columns: { plan: { required: true, field: "comm_plan_definition", by: "name" } },
        },
      ],
    },
  },
  files: {
    "modules/major-incident/source/global/src/fluent/m.now.ts": "// m",
    "modules/major-incident/data/demo/contact.csv": "plan\nMI plan\n",
  },
};

const schema = (tables: Record<string, readonly string[]>): SchemaReader => ({
  ready: async () => true,
  fieldsOf: async (table) => tables[table] ?? null,
  refresh: () => {},
});
const inventory = (mim: "active" | "inactive"): InventoryReader => ({
  read: async (_r, _i, file) =>
    file === "plugins" ? [{ id: MIM, active: mim, version: "1.0.0" }] : [],
});
const templates: DataTemplates = {
  tracked: async () => false,
  read: async () => null,
  parse: (text) => {
    const [head = "", ...rows] = text.trim().split("\n");
    return { columns: head.split(","), rows: rows.map((r) => r.split(",")) };
  },
};
const workspace: PackWorkspace = {
  installReports: async () => [],
  mirrorCommit: async () => "m1",
  includes: async () => true,
  present: async () => [],
  parse: (text) => JSON.parse(text),
  previous: async () => ({ written: [], kept: [] }),
  commit: async () => "c",
  merge: async () => ({ branch: "b", conflicts: [] }),
};
const QUERY = {
  pack: "itsm",
  instance: { root: "/w", name: "pdi3", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.9.0",
  signal: new AbortController().signal,
};
const plan = (mim: "active" | "inactive", tables: Record<string, readonly string[]>) =>
  planInstall(
    {
      packs: memoryPacks({ itsm: packFiles(PACK) }),
      inventory: inventory(mim),
      workspace,
      templates,
      updateSets: { open: async () => [] },
      schema: schema(tables),
    },
    QUERY,
  );

// pdi3 before the install: no MIM fields, no comm_contact_definition table.
const FRESH = { incident: ["parent_incident"] };

describe("fields a plugin the plan activates brings", () => {
  it("checks them after the activation instead of refusing the plan", async () => {
    const result = await plan("inactive", FRESH);
    const states = Object.fromEntries(result.fields.map((f) => [`${f.table}.${f.field}`, f.state]));
    expect(states).toMatchObject({
      "incident.major_incident_state": "after-activation",
      "comm_contact_definition.comm_plan_definition": "after-activation",
    });
    expect(result.problems.filter((p) => p.includes("major_incident_state"))).toEqual([]);
    expect(result.problems.filter((p) => p.includes("comm_contact_definition"))).toEqual([]);
  });

  it("still refuses a missing field whose plugin is already active, or that names no source", async () => {
    const result = await plan("active", FRESH);
    expect(result.problems).toContainEqual(
      expect.stringContaining("field incident.major_incident_state (major-incident)"),
    );
    const inactive = await plan("inactive", FRESH);
    expect(inactive.problems).toContainEqual(
      expect.stringContaining("field incident.u_mystery (major-incident)"),
    );
  });

  it("tells the admin which fields wait for the activation", async () => {
    const document = installPlanDocument(await plan("inactive", FRESH));
    expect(document).toContain(
      "| `incident.major_incident_state` | major-incident | **after activation** | com.snc.incident.mim | checked again once com.snc.incident.mim is active |",
    );
  });
});

// The mirror before and after the activation's pull: the reader sees the new fields only once it
// is refreshed, as the knowledge index does.
function changingMirror(after: Record<string, readonly string[]>) {
  const state = {
    pulled: false,
    refreshed: false,
    tables: FRESH as Record<string, readonly string[]>,
  };
  const reader: SchemaReader = {
    ready: async () => true,
    fieldsOf: async (table) => state.tables[table] ?? null,
    refresh: () => {
      state.refreshed = true;
      if (state.pulled) state.tables = after;
    },
  };
  return { reader, state };
}

const AFTER_MIM = {
  incident: ["parent_incident", "major_incident_state", "u_mystery"],
  comm_contact_definition: ["comm_plan_definition"],
};

async function run(after: Record<string, readonly string[]>, mystery = true) {
  const pack: PackFixture = mystery
    ? PACK
    : {
        ...PACK,
        modules: {
          "major-incident": {
            ...(PACK.modules["major-incident"] as object),
            fields: [
              { field: "incident.major_incident_state", from: MIM },
              { field: "incident.parent_incident", from: "com.snc.incident" },
            ],
          },
        },
      };
  const mirror = changingMirror(after);
  const fakes = fakeSteps();
  const refresh = fakes.steps.refresh;
  const steps = {
    ...fakes.steps,
    refresh: async (signal: AbortSignal) => {
      mirror.state.pulled = true;
      await refresh(signal);
    },
  };
  const { journal, state } = memoryJournal();
  const plugins = { mim: "inactive" as "active" | "inactive" };
  const deps = {
    packs: memoryPacks({ itsm: packFiles(pack) }),
    inventory: {
      read: (root: string, instance: string, file: string) =>
        inventory(plugins.mim).read(root, instance, file),
    },
    workspace,
    templates,
    updateSets: { open: async () => [] },
    schema: mirror.reader,
    steps,
    journal,
    now: () => new Date(0),
  };
  const planned = await planInstall(deps, QUERY);
  const result = await installPack(deps, { ...QUERY, confirm: planned.planId });
  return {
    planned,
    result,
    calls: fakes.calls,
    mirror: mirror.state,
    journal: state,
    deps,
    plugins,
  };
}

describe("checking those fields once the plugin is active", () => {
  it("checks them after the activation's pull, against a fresh mirror, before the first push", async () => {
    const { planned, result, calls, mirror } = await run(AFTER_MIM, false);
    expect(planned.problems).toEqual([]);
    expect(result.steps.map((s) => [s.step, s.outcome])).toEqual([
      [`activate ${MIM}`, "done"],
      ["pull and integrate", "done"],
      ["check fields", "done"],
      ["module major-incident", "done"],
      ["data", "done"],
      ["pull and integrate", "done"],
    ]);
    expect(mirror.refreshed).toBe(true);
    expect(calls.indexOf("refresh")).toBeLessThan(calls.findIndex((c) => c.startsWith("push")));
  });

  it("stops before any push when one is still missing, naming it", async () => {
    const { result, calls } = await run({ incident: ["parent_incident"] }, false);
    expect(result.stopped?.step).toBe("check fields");
    expect(result.stopped?.detail).toContain(
      "field incident.major_incident_state (major-incident) is not on the instance",
    );
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });

  it("checks again when a stopped run resumes, and goes on once the field is there", async () => {
    const first = await run({ incident: ["parent_incident"] }, false);
    expect(first.result.stopped?.step).toBe("check fields");
    // The admin repairs the plugin and the instance is pulled: MIM is active, its field there.
    first.plugins.mim = "active";
    first.mirror.tables = AFTER_MIM;
    const resumed = await installPack(first.deps, { ...QUERY, confirm: first.planned.planId });
    expect(resumed.stopped).toBeNull();
    expect(resumed.steps.filter((s) => s.step === "check fields").map((s) => s.outcome)).toEqual([
      "stopped",
      "done",
    ]);
  });
});
