import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  PackNotFoundError,
  type PackSource,
  TrackedDataError,
  validateData,
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
          entity: "group",
          table: "x_t_group",
          key: ["name"],
          columns: { name: { required: true } },
        },
      ],
    },
  },
};
const packs: PackSource = {
  ids: async () => ["minimal"],
  manifest: async (id) => (id === "minimal" ? MANIFEST : null),
  files: async () => new Map(),
};
const templates = (tracked: boolean): DataTemplates => ({
  tracked: async () => tracked,
  read: async (_dir, file) =>
    file === "group.csv" ? { columns: ["name"], rows: [["Desk"]] } : null,
});

describe("accelerator data validation", () => {
  it("validates the selection's templates from a directory", async () => {
    const report = await validateData(
      { packs, templates: templates(false) },
      { pack: "minimal", directory: "/d" },
    );
    expect(report).toEqual({
      selected: ["base"],
      entities: [{ entity: "group", rows: 1, problems: [] }],
      passed: true,
    });
  });

  it("refuses a directory git tracks: customer data is never committed", async () => {
    await expect(
      validateData(
        { packs, templates: templates(true) },
        { pack: "minimal", directory: "/w/data" },
      ),
    ).rejects.toThrow(TrackedDataError);
  });

  it("refuses an unknown pack", async () => {
    await expect(
      validateData({ packs, templates: templates(false) }, { pack: "itsm", directory: "/d" }),
    ).rejects.toThrow(PackNotFoundError);
  });
});
