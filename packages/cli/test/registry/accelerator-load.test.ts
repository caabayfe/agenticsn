import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CsvDataTemplates } from "../../src/adapters/accelerators/csv-data-templates";
import { DirectoryPackSource } from "../../src/adapters/accelerators/directory-pack-source";
import { acceleratorLoad } from "../../src/registry/accelerator-load";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const PACKS = new DirectoryPackSource([
  resolve(import.meta.dir, "../../../../tests/fixtures/accelerators"),
]);

async function loading(imports: boolean) {
  const { context } = await instanceWorkspace({ sys_user: [{ sys_id: "u1", user_name: "admin" }] });
  const posted: string[] = [];
  const open = context.connections.open;
  const data = mkdtempSync(join(tmpdir(), "pack-data-"));
  writeFileSync(join(data, "location.csv"), "name,city\nSydney HQ,Sydney\nMelbourne,Melbourne\n");
  return {
    posted,
    data,
    context: {
      ...context,
      packs: PACKS,
      dataTemplates: new CsvDataTemplates(),
      connections: {
        open: (...args: Parameters<typeof open>) => ({
          ...open(...args),
          ...(imports
            ? {
                imports: {
                  post: async (table: string, row: Readonly<Record<string, string>>) => {
                    posted.push(`${table} ${row["name"]}`);
                    return {
                      status:
                        row["name"] === "Melbourne" ? ("error" as const) : ("inserted" as const),
                      sysId: "s",
                    };
                  },
                },
              }
            : {}),
        }),
      },
    },
  };
}

describe("accelerator load", () => {
  it("loads the templates into the development instance and names the rows not taken", async () => {
    const { context, data, posted } = await loading(true);
    const { output } = await executeUseCase(
      acceleratorLoad,
      { pack: "minimal", instance: "pdi", data, confirm: true },
      context,
    );
    expect(posted).toEqual(["imp_location Sydney HQ", "imp_location Melbourne"]);
    expect(output).toMatchObject({
      instance: "pdi",
      stopped: true,
      entities: [{ entity: "location", failed: ["Melbourne"] }],
    });
    const text = acceleratorLoad.render(output as never, "text");
    expect(text).toContain("location: 1 inserted, 0 updated, 0 unchanged, 1 not taken");
    expect(text).toContain("not taken: Melbourne");
    expect(acceleratorLoad.exitCode(output as never)).toBe(1);
    const done = { ...(output as never as Record<string, unknown>), stopped: false, entities: [] };
    expect(acceleratorLoad.render(done as never, "text")).toBe("loaded into pdi");
    expect(acceleratorLoad.exitCode(done as never)).toBe(0);
  });

  it("refuses a connection that cannot load through import sets", async () => {
    const { context, data } = await loading(false);
    await expect(
      executeUseCase(
        acceleratorLoad,
        { pack: "minimal", instance: "pdi", data, confirm: true },
        context,
      ),
    ).rejects.toThrow("cannot load data through import sets");
  });
});
