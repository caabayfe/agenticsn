import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  PackNotFoundError,
  TrackedDataError,
  validateData,
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
            entity: "group",
            table: "x_t_group",
            key: ["name"],
            columns: { name: { required: true } },
          },
        ],
      },
    },
    files: { "modules/base/data/demo/group.csv": "name\nDemo desk\nDemo field\n" },
  }),
});

const parseCsv = (text: string) => {
  const [head = "", ...rows] = text.trim().split("\n");
  return { columns: head.split(","), rows: rows.map((r) => r.split(",")) };
};

function templates(tracked: boolean) {
  const asked: string[] = [];
  const port: DataTemplates = {
    tracked: async (directory) => {
      asked.push(directory);
      return tracked;
    },
    read: async (_dir, file) =>
      file === "group.csv" ? { columns: ["name"], rows: [["Desk"]] } : null,
    parse: parseCsv,
  };
  return { port, asked };
}

const directory = (path: string) => ({ kind: "directory" as const, directory: path });

describe("accelerator data validation", () => {
  it("validates the selection's templates from a directory", async () => {
    const report = await validateData(
      { packs, templates: templates(false).port },
      { pack: "minimal", source: directory("/d") },
    );
    expect(report).toEqual({
      selected: ["base"],
      entities: [{ entity: "group", rows: 1, problems: [] }],
      passed: true,
    });
  });

  it("reads the pack's own demo data from modules/<module>/data/demo/", async () => {
    const report = await validateData(
      { packs, templates: templates(false).port },
      { pack: "minimal", source: { kind: "demo" } },
    );
    expect(report).toEqual({
      selected: ["base"],
      entities: [{ entity: "group", rows: 2, problems: [] }],
      passed: true,
    });
  });

  it("refuses a directory git tracks: customer data is never committed", async () => {
    await expect(
      validateData(
        { packs, templates: templates(true).port },
        { pack: "minimal", source: directory("/w/data") },
      ),
    ).rejects.toThrow(TrackedDataError);
  });

  it("does not ask git about the demo data: the pack ships it, and it is fictional", async () => {
    const { port, asked } = templates(true);
    const report = await validateData(
      { packs, templates: port },
      { pack: "minimal", source: { kind: "demo" } },
    );
    expect(report.passed).toBe(true);
    expect(asked).toEqual([]);
  });

  it("refuses an unknown pack", async () => {
    await expect(
      validateData(
        { packs, templates: templates(false).port },
        { pack: "itsm", source: directory("/d") },
      ),
    ).rejects.toThrow(PackNotFoundError);
  });
});
