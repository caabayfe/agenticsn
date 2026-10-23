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

// The mirror's domains: none on a fresh instance (pdi3), some where data is separated (pdi2).
async function loading(imports: boolean, domains: readonly Record<string, string>[] = []) {
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
      inventory: {
        read: async (_r: string, _i: string, file: string) => (file === "domains" ? domains : null),
      },
      packs: PACKS,
      dataTemplates: new CsvDataTemplates(),
      connections: {
        open: (...args: Parameters<typeof open>) => ({
          ...open(...args),
          ...(imports
            ? {
                imports: {
                  post: async (table: string, row: Readonly<Record<string, string>>) => {
                    posted.push(
                      `${table} ${row["name"]}${row["u_sys_domain"] === undefined ? "" : ` in ${row["u_sys_domain"]}`}`,
                    );
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

  it("puts every row into the domain --domain names where the instance separates data", async () => {
    const acme = { sys_id: "a".repeat(32), name: "ACME", parent: "", active: "true" };
    const { context, data, posted } = await loading(true, [acme]);
    await expect(
      executeUseCase(
        acceleratorLoad,
        { pack: "minimal", instance: "pdi", data, confirm: true },
        context,
      ),
    ).rejects.toMatchObject({ code: "data-domain" });
    expect(posted).toEqual([]);
    await executeUseCase(
      acceleratorLoad,
      { pack: "minimal", instance: "pdi", data, confirm: true, domain: "ACME" },
      context,
    );
    expect(posted[0]).toBe(`imp_location Sydney HQ in ${"a".repeat(32)}`);
  });
});
