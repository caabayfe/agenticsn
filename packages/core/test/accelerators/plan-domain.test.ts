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
import { memoryPacks, packFiles } from "../support/memory-packs";

// The install plan decides the domain the data goes into, from the mirror's domains and
// --domain, and checks the templates and fields as the load will use them (spec 011, §15).

const ACME = "c90d4b084a362312013398f051272c0d";
const PACK = packFiles({
  pack: { id: "itsm", version: "1.0.0", requires: { snagentic: ">=2.9.0" } },
  modules: {
    foundation: {
      label: "ITSM: foundation",
      data: [
        {
          entity: "group",
          table: "u_acc_imp_group",
          target: "sys_user_group",
          key: ["name"],
          columns: {
            name: { required: true, field: "name" },
            company: { field: "company", domain: true },
          },
        },
      ],
    },
  },
  files: {
    "modules/foundation/source/global/src/fluent/f.now.ts": "// f",
    "modules/foundation/data/demo/group.csv": "name,company\nService Desk,Nordvale\n",
  },
});

const inventory = (domains: readonly Record<string, string>[] | null): InventoryReader => ({
  read: async (_r, _i, file) => (file === "domains" ? domains : []),
});
const ACME_ONLY = [{ sys_id: ACME, name: "ACME", parent: "", active: "true" }];
// sys_user_group as domain separation leaves it, and as a fresh instance has it.
const schema = (company: boolean): SchemaReader => ({
  ready: async () => true,
  fieldsOf: async (table) =>
    table === "sys_user_group" ? ["name", ...(company ? ["company"] : [])] : null,
  refresh: () => {},
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
const deps = (domains: readonly Record<string, string>[] | null, company: boolean) => ({
  packs: memoryPacks({ itsm: PACK }),
  inventory: inventory(domains),
  workspace,
  templates,
  updateSets: { open: async () => [] },
  schema: schema(company),
});
const QUERY = {
  pack: "itsm",
  instance: { root: "/w", name: "pdi2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.9.0",
  signal: new AbortController().signal,
};

describe("the install plan on an instance with or without domains", () => {
  it("needs --domain where the instance separates data by domain, and checks its columns' fields", async () => {
    const missing = await planInstall(deps(ACME_ONLY, true), QUERY);
    expect(missing.problems).toContain(
      "pdi2 separates data by domain: name the domain the data goes into with --domain (one of: ACME)",
    );
    const lacking = await planInstall(deps(ACME_ONLY, false), { ...QUERY, domain: "ACME" });
    expect(lacking.problems).toContainEqual(
      expect.stringContaining("field sys_user_group.company (foundation) is not on the instance"),
    );
    const plan = await planInstall(deps(ACME_ONLY, true), { ...QUERY, domain: "ACME" });
    expect(plan.problems).toEqual([]);
    expect(plan.data.domain).toEqual({ separated: true, name: "ACME", sysId: ACME });
    expect(installPlanDocument(plan)).toContain(
      "Every row goes into the domain **ACME**; columns only domain separation uses are mandatory: group.company.",
    );
  });

  it("leaves the domain columns and their fields out where it does not", async () => {
    const plan = await planInstall(deps([], false), QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.fields.map((f) => `${f.table}.${f.field}`)).not.toContain("sys_user_group.company");
    expect(installPlanDocument(plan)).toContain(
      "The instance does not separate data by domain: these columns are left out: group.company.",
    );
    const refused = await planInstall(deps([], false), { ...QUERY, domain: "ACME" });
    expect(refused.problems).toContain(
      "--domain ACME: pdi2 does not separate data by domain; leave --domain out",
    );
  });

  it("makes a new plan id for another domain, and keeps the id where there are none", async () => {
    const acme = await planInstall(deps(ACME_ONLY, true), { ...QUERY, domain: "ACME" });
    const other = [
      ...ACME_ONLY,
      { sys_id: "b".repeat(32), name: "Initech", parent: "", active: "true" },
    ];
    const initech = await planInstall(deps(other, true), { ...QUERY, domain: "Initech" });
    expect(initech.planId).not.toBe(acme.planId);
  });

  it("loads the data into the planned domain", async () => {
    const fakes = fakeSteps();
    const loads: (string | null)[] = [];
    const steps = {
      ...fakes.steps,
      load: async (
        modules: readonly string[],
        source: Parameters<typeof fakes.steps.load>[1],
        domain: string | null,
        signal: AbortSignal,
      ) => {
        loads.push(domain);
        return fakes.steps.load(modules, source, domain, signal);
      },
    };
    const run = {
      ...deps(ACME_ONLY, true),
      steps,
      journal: memoryJournal().journal,
      now: () => new Date(0),
    };
    const plan = await planInstall(run, { ...QUERY, domain: "ACME" });
    const result = await installPack(run, { ...QUERY, domain: "ACME", confirm: plan.planId });
    expect(result.stopped).toBeNull();
    expect(loads).toEqual(["ACME"]);
  });
});
