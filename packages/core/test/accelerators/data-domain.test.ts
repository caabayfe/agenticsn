import { describe, expect, it } from "bun:test";
import {
  type DataDomain,
  type DataTemplates,
  type ImportSetWriter,
  loadData,
  resolveDataDomain,
  validateData,
} from "@snagentic/core";
import { memoryPacks, packFiles } from "../support/memory-packs";

// On an instance that separates data by domain every row is loaded into the domain --domain
// names, and the columns only domain separation uses are filled in every row. Elsewhere those
// columns are dropped (spec 011, section 15, items 5 to 8).

const ACME = "c90d4b084a362312013398f051272c0d";
// pdi2's mirrored domains (operational/domains.yaml).
const DOMAINS = [
  { sys_id: "774190f01f1310005a3637b8ec8b70ef", name: "TOP", parent: "", active: "true" },
  { sys_id: ACME, name: "ACME", parent: "774190f01f1310005a3637b8ec8b70ef", active: "true" },
  { sys_id: "dead", name: "Retired", parent: "", active: "false" },
];

describe("the domain a load goes into", () => {
  it("is none on an instance without domain separation, and refuses --domain there", () => {
    expect(resolveDataDomain([], undefined, "pdi3")).toEqual({
      domain: { separated: false },
      problems: [],
    });
    expect(resolveDataDomain([], "ACME", "pdi3").problems).toEqual([
      "--domain ACME: pdi3 does not separate data by domain; leave --domain out",
    ]);
  });

  it("must be named on an instance that separates data by domain, among its active domains", () => {
    expect(resolveDataDomain(DOMAINS, "ACME", "pdi2")).toEqual({
      domain: { separated: true, name: "ACME", sysId: ACME },
      problems: [],
    });
    expect(resolveDataDomain(DOMAINS, undefined, "pdi2").problems).toEqual([
      "pdi2 separates data by domain: name the domain the data goes into with --domain (one of: ACME, TOP)",
    ]);
    expect(resolveDataDomain(DOMAINS, "Retired", "pdi2").problems).toEqual([
      "--domain Retired: no active domain of that name on pdi2 (one of: ACME, TOP)",
    ]);
  });

  it("asks for a pull when the mirror does not say whether the instance separates data", () => {
    expect(resolveDataDomain(null, undefined, "pdi3").problems).toEqual([
      "pull pdi3 first: the mirror does not say whether it separates data by domain",
    ]);
  });
});

const PACK = memoryPacks({
  itsm: packFiles({
    pack: { id: "itsm", version: "1.0.0", requires: { snagentic: ">=2.9.0" } },
    modules: {
      foundation: {
        label: "foundation",
        data: [
          {
            entity: "company",
            table: "u_acc_imp_company",
            target: "core_company",
            key: ["name"],
            columns: { name: { required: true, field: "name" } },
          },
          {
            entity: "group",
            table: "u_acc_imp_group",
            target: "sys_user_group",
            key: ["name"],
            after: ["company"],
            columns: {
              name: { required: true, field: "name" },
              company: { field: "company", references: "company", domain: true },
            },
          },
        ],
      },
    },
    files: {},
  }),
});
const FILES: Record<string, { columns: string[]; rows: string[][] }> = {
  "company.csv": { columns: ["name"], rows: [["Nordvale"]] },
  "group.csv": {
    columns: ["name", "company"],
    rows: [
      ["Service Desk", "Nordvale"],
      ["Network", ""],
    ],
  },
};
const templates = (files = FILES): DataTemplates => ({
  tracked: async () => false,
  read: async (_d, file) => files[file] ?? null,
  parse: () => ({ columns: [], rows: [] }),
});
const QUERY = { pack: "itsm", source: { kind: "directory" as const, directory: "/d" } };
const SEPARATED: DataDomain = { separated: true, name: "ACME", sysId: ACME };

describe("templates on an instance with or without domains", () => {
  it("needs a domain column in every row where the instance separates data by domain", async () => {
    const report = await validateData(
      { packs: PACK, templates: templates() },
      { ...QUERY, domain: SEPARATED },
    );
    expect(report.entities.find((e) => e.entity === "group")?.problems).toEqual([
      "row 2 (Network): company is mandatory",
    ]);
  });

  it("ignores a domain column elsewhere, present or not", async () => {
    const without = { ...FILES, "group.csv": { columns: ["name"], rows: [["Network"]] } };
    for (const files of [FILES, without]) {
      const report = await validateData(
        { packs: PACK, templates: templates(files) },
        { ...QUERY, domain: { separated: false } },
      );
      expect(report.passed).toBe(true);
    }
  });
});

function importer() {
  const posted: { table: string; row: Record<string, string> }[] = [];
  const writer: ImportSetWriter = {
    post: async (table, row) => {
      posted.push({ table, row: { ...row } });
      return { status: "inserted", sysId: "s" };
    },
  };
  return { writer, posted };
}
const COMPLETE = {
  ...FILES,
  "group.csv": { columns: ["name", "company"], rows: [["Service Desk", "Nordvale"]] },
};
const load = async (domain: DataDomain, files = COMPLETE) => {
  const { writer, posted } = importer();
  await loadData(
    { packs: PACK, templates: templates(files), importer: writer },
    { ...QUERY, domain, confirm: true, signal: new AbortController().signal },
  );
  return posted;
};

describe("loading rows with or without domains", () => {
  it("puts every row into the named domain, with its domain columns", async () => {
    expect(await load(SEPARATED)).toEqual([
      { table: "u_acc_imp_company", row: { u_name: "Nordvale", u_sys_domain: ACME } },
      {
        table: "u_acc_imp_group",
        row: { u_name: "Service Desk", u_company: "Nordvale", u_sys_domain: ACME },
      },
    ]);
  });

  it("sends no domain and drops the domain columns where the instance has no domains", async () => {
    expect(await load({ separated: false })).toEqual([
      { table: "u_acc_imp_company", row: { u_name: "Nordvale" } },
      { table: "u_acc_imp_group", row: { u_name: "Service Desk" } },
    ]);
  });
});
