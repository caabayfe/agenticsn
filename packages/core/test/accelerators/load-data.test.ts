import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  type ImportSetWriter,
  type ImportStatus,
  LoadConfirmationRequiredError,
  loadData,
  TemplatesInvalidError,
} from "@snagentic/core";
import { memoryPacks, packFiles } from "../support/memory-packs";

const packs = memoryPacks({
  minimal: packFiles({
    pack: { id: "minimal", version: "1.0.0", requires: { snagentic: ">=1.6.0" } },
    modules: {
      base: {
        label: "base",
        data: [
          {
            entity: "location",
            table: "imp_location",
            key: ["name"],
            after: ["company"],
            columns: { name: { required: true } },
          },
          {
            entity: "company",
            table: "imp_company",
            key: ["name"],
            columns: { name: { required: true } },
          },
        ],
      },
    },
    files: {
      "modules/base/data/demo/company.csv": "name\nDemo company\n",
      "modules/base/data/demo/location.csv": "name\nDemo city\n",
    },
  }),
});
const TEMPLATES: Record<string, { columns: string[]; rows: string[][] }> = {
  "company.csv": {
    columns: ["name", "notes"],
    rows: [
      ["Acme", "secret"],
      ["Globex", "secret"],
    ],
  },
  "location.csv": { columns: ["name"], rows: [["Sydney"]] },
};
const templates = (files = TEMPLATES): DataTemplates => ({
  tracked: async () => false,
  read: async (_d, file) => files[file] ?? null,
  parse: (text) => {
    const [head = "", ...rows] = text.trim().split("\n");
    return { columns: head.split(","), rows: rows.map((r) => r.split(",")) };
  },
});

function importer(
  statusOf: (table: string, row: Record<string, string>) => ImportStatus = () => "inserted",
) {
  const posted: { table: string; row: Record<string, string> }[] = [];
  const writer: ImportSetWriter = {
    post: async (table, row) => {
      posted.push({ table, row: { ...row } });
      return { status: statusOf(table, { ...row }), sysId: "s" };
    },
  };
  return { writer, posted };
}

const QUERY = {
  pack: "minimal",
  source: { kind: "directory" as const, directory: "/d" },
  domain: { separated: false } as const,
  confirm: true,
  signal: new AbortController().signal,
};

describe("accelerator load (ADR-0026, item 3)", () => {
  it("loads each entity in load order, one row per request, and counts the outcomes", async () => {
    const { writer, posted } = importer((_t, row) =>
      row["name"] === "Globex" ? "updated" : "inserted",
    );
    const result = await loadData({ packs, templates: templates(), importer: writer }, QUERY);
    expect(posted.map((p) => `${p.table} ${p.row["name"]}`)).toEqual([
      "imp_company Acme",
      "imp_company Globex",
      "imp_location Sydney",
    ]);
    expect(posted[0]?.row).toEqual({ name: "Acme", notes: "secret" });
    expect(result).toEqual({
      entities: [
        {
          entity: "company",
          counts: { inserted: 1, updated: 1, ignored: 0, skipped: 0, error: 0 },
          failed: [],
          problems: [],
        },
        {
          entity: "location",
          counts: { inserted: 1, updated: 0, ignored: 0, skipped: 0, error: 0 },
          failed: [],
          problems: [],
        },
      ],
      stopped: false,
    });
  });

  it("stops after the first entity with rows the instance did not take, naming them by key only", async () => {
    const { writer, posted } = importer((_t, row) =>
      row["name"] === "Acme" ? "error" : "inserted",
    );
    const result = await loadData({ packs, templates: templates(), importer: writer }, QUERY);
    expect(result.stopped).toBe(true);
    expect(result.entities).toEqual([
      {
        entity: "company",
        counts: { inserted: 1, updated: 0, ignored: 0, skipped: 0, error: 1 },
        failed: ["Acme"],
        problems: [
          {
            reason: "the transform failed it",
            action: "the comment on its row in imp_company gives the platform's reason",
            rows: ["Acme"],
          },
        ],
      },
    ]);
    expect(posted.some((p) => p.table === "imp_location")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("loads nothing until every template passes", async () => {
    const { writer, posted } = importer();
    const broken = { ...TEMPLATES, "location.csv": { columns: ["name"], rows: [[""]] } };
    await expect(
      loadData({ packs, templates: templates(broken), importer: writer }, QUERY),
    ).rejects.toThrow(TemplatesInvalidError);
    expect(posted).toEqual([]);
  });

  it("loads the pack's demo data, in load order, from the pack itself", async () => {
    const { writer, posted } = importer();
    const result = await loadData(
      { packs, templates: templates({}), importer: writer },
      { ...QUERY, source: { kind: "demo" } },
    );
    expect(posted.map((p) => `${p.table} ${p.row["name"]}`)).toEqual([
      "imp_company Demo company",
      "imp_location Demo city",
    ]);
    expect(result.stopped).toBe(false);
  });

  it("needs confirmation, and stops when cancelled", async () => {
    const { writer, posted } = importer();
    await expect(
      loadData({ packs, templates: templates(), importer: writer }, { ...QUERY, confirm: false }),
    ).rejects.toThrow(LoadConfirmationRequiredError);
    const cancel = new AbortController();
    cancel.abort();
    await expect(
      loadData(
        { packs, templates: templates(), importer: writer },
        { ...QUERY, signal: cancel.signal },
      ),
    ).rejects.toThrow();
    expect(posted).toEqual([]);
  });
});
