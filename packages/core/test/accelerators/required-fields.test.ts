import { describe, expect, it } from "bun:test";
import {
  checkFields,
  type DataTemplates,
  type InventoryReader,
  installPlanDocument,
  type PackWorkspace,
  parseManifest,
  planInstall,
  requiredFields,
  type SchemaReader,
} from "@snagentic/core";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// Plan gap G13 (ITSM pack): a module declares the platform fields it reads, and the install plan
// checks them against the mirror before anything is pushed (spec 011, I14).

const PACK: PackFixture = {
  pack: { id: "itsm", version: "0.1.0", requires: { snagentic: ">=2.6.0" } },
  modules: {
    relations: {
      label: "ITSM: relations",
      fields: [
        {
          field: "incident.caused_by",
          from: "com.snc.change_management",
          when_missing: "warn",
          note: "Related Changes leaves out the change that caused the incident",
        },
        { field: "incident.parent_incident", from: "com.snc.incident" },
      ],
      data: [
        {
          entity: "contact",
          table: "u_acc_imp_contact",
          target: "comm_contact_definition",
          key: ["plan"],
          columns: {
            plan: { required: true, field: "comm_plan_definition", by: "name" },
            note: { field: "u_note" },
          },
        },
      ],
    },
  },
  files: { "modules/relations/source/global/src/fluent/r.now.ts": "// r" },
};

const manifestOf = (fixture: PackFixture) => {
  const modules = Object.fromEntries(Object.entries(fixture.modules).map(([id, m]) => [id, m]));
  const outcome = parseManifest({ ...fixture.pack, modules });
  if (!outcome.ok) throw new Error(outcome.problems.join("; "));
  return outcome.manifest;
};

// The mirror's schema: each table's fields, its parents' included.
const schema = (tables: Record<string, readonly string[]>, ready = true): SchemaReader => ({
  ready: async () => ready,
  fieldsOf: async (table) => tables[table] ?? null,
});

describe("the platform fields a module reads (G13)", () => {
  it("reads a module's declared fields, stopping by default", () => {
    const relations = manifestOf(PACK).capabilities[0];
    expect(relations?.fields).toEqual([
      {
        table: "incident",
        field: "caused_by",
        from: "com.snc.change_management",
        whenMissing: "warn",
        note: "Related Changes leaves out the change that caused the incident",
      },
      {
        table: "incident",
        field: "parent_incident",
        from: "com.snc.incident",
        whenMissing: "stop",
        note: null,
      },
    ]);
  });

  it("names a declared field that is not table.field, or a when_missing it does not know", () => {
    const outcome = parseManifest({
      ...PACK.pack,
      modules: {
        relations: { fields: [{ field: "caused_by" }, { field: "a.b", when_missing: "skip" }] },
      },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problems).toContain("module relations: field 1 must be table.field");
    expect(outcome.problems).toContain("module relations: field 2 when_missing is stop or warn");
  });

  it("adds the fields its data columns fill, but not the pack's own u_ fields", () => {
    const relations = manifestOf(PACK).capabilities[0];
    if (relations === undefined) throw new Error("no module");
    expect(requiredFields(relations).map((f) => `${f.table}.${f.field} ${f.whenMissing}`)).toEqual([
      "incident.caused_by warn",
      "incident.parent_incident stop",
      "comm_contact_definition.comm_plan_definition stop",
    ]);
  });

  it("finds a field on the table or its parents, and reports a missing field or table", async () => {
    const relations = manifestOf(PACK).capabilities[0];
    if (relations === undefined) throw new Error("no module");
    const checks = await checkFields(
      [relations],
      schema({ incident: ["parent_incident", "short_description"] }),
    );
    expect(checks.map((c) => `${c.module} ${c.table}.${c.field} ${c.state}`)).toEqual([
      "relations incident.caused_by missing",
      "relations incident.parent_incident present",
      "relations comm_contact_definition.comm_plan_definition no-table",
    ]);
  });
});

const inventory: InventoryReader = {
  read: async (_r, _i, file) => (file === "plugins" ? [] : []),
};
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
const WITH_DATA = {
  ...PACK,
  files: { ...PACK.files, "modules/relations/data/demo/contact.csv": "plan,note\nMI plan,x\n" },
};
const QUERY = {
  pack: "itsm",
  instance: { root: "/w", name: "pdi2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.6.0",
  signal: new AbortController().signal,
};
const updateSets = { open: async () => [] };
const plan = (reader: SchemaReader) =>
  planInstall(
    {
      packs: memoryPacks({ itsm: packFiles(WITH_DATA) }),
      inventory,
      workspace,
      templates,
      updateSets,
      schema: reader,
    },
    QUERY,
  );

const PDI2 = {
  incident: ["parent_incident"],
  comm_contact_definition: ["comm_plan_definition"],
};

describe("checking the fields in the install plan (G13)", () => {
  it("warns about a missing field that may be missing, naming what it costs and its plugin", async () => {
    const result = await plan(schema(PDI2));
    expect(result.problems).toEqual([]);
    expect(result.warnings).toContain(
      "field incident.caused_by (relations) is not on the instance: Related Changes leaves out the change that caused the incident. It ships with com.snc.change_management: repair or activate it on the instance, then pull",
    );
  });

  it("blocks on a missing field the module needs", async () => {
    const result = await plan(schema({ ...PDI2, incident: [] }));
    expect(result.problems).toContain(
      "field incident.parent_incident (relations) is not on the instance. It ships with com.snc.incident: repair or activate it on the instance, then pull",
    );
  });

  it("blocks when the mirror holds no schema yet, asking for a pull", async () => {
    const result = await plan(schema({}, false));
    expect(result.problems).toContain(
      "pull pdi2 first: the mirror holds no tables, so the fields the modules read cannot be checked",
    );
  });

  it("never reads the mirror's schema when its modules read no platform field", async () => {
    const bare: PackFixture = { ...PACK, modules: { relations: { label: "ITSM: relations" } } };
    let asked = false;
    const result = await planInstall(
      {
        packs: memoryPacks({ itsm: packFiles(bare) }),
        inventory,
        workspace,
        templates,
        updateSets,
        schema: {
          ready: async () => {
            asked = true;
            return false;
          },
          fieldsOf: async () => null,
        },
      },
      QUERY,
    );
    expect(asked).toBe(false);
    expect(result.fields).toEqual([]);
  });

  it("changes its id when a field appears on the instance", async () => {
    const before = await plan(schema(PDI2));
    const after = await plan(schema({ ...PDI2, incident: ["parent_incident", "caused_by"] }));
    expect(after.planId).not.toBe(before.planId);
  });

  it("lists the missing fields in the document the admin approves, and counts the rest", async () => {
    const document = installPlanDocument(await plan(schema(PDI2)));
    expect(document).toContain("Platform fields");
    expect(document).toContain(
      "| `incident.caused_by` | relations | **missing** | com.snc.change_management | install anyway: Related Changes leaves out the change that caused the incident |",
    );
    expect(document).not.toContain("`incident.parent_incident`");
    expect(document).toContain("The other 2 field(s) the modules read are on the instance.");
  });
});
