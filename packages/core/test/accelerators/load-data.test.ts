import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  type ImportSetWriter,
  type ImportStatus,
  LoadConfirmationRequiredError,
  loadData,
  type PackSource,
  TemplatesInvalidError,
} from "@snagentic/core";

const MANIFEST = {
  id: "minimal",
  version: "1.0.0",
  requires: { snagentic: ">=1.6.0" },
  scope: "x_snagentic_min",
  capabilities: {
    base: {
      wave: 0,
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
};
const packs: PackSource = {
  ids: async () => ["minimal"],
  manifest: async () => MANIFEST,
  files: async () => new Map(),
};
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
  directory: "/d",
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
        },
        {
          entity: "location",
          counts: { inserted: 1, updated: 0, ignored: 0, skipped: 0, error: 0 },
          failed: [],
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
