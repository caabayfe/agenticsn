import { describe, expect, it } from "bun:test";
import { pulledInstance, SECTION, sid } from "../support/incremental-fixture";

// ADR-0052 items 4 and 7: a pull by a user other than the mirror's never removes by absence,
// and a watermark ahead of the instance's clock is refused.
describe("pullIncremental by a user other than the mirror's", () => {
  it("keeps a child-row file whose rows its listing no longer returns", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_ui_element"] = [];
    const { summary } = await incremental({}, { absence: "keep" });
    expect(summary.removedChildFiles).toBe(0);
    expect(files.has(`${SECTION}.children.sys_ui_element.yaml`)).toBe(true);
  });

  it("keeps a record its count does not list, but still repairs what is missing", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_script"] = tables["sys_script"]?.slice(0, 1) ?? [];
    const { summary } = await incremental({ verify: true }, { absence: "keep" });
    expect(summary.verification).toMatchObject({ removed: 0 });
    expect(files.has(`global/sys_script/two--${sid(2)}.yaml`)).toBe(true);
  });

  it("refuses a watermark later than the instance's own clock", async () => {
    const pulled = await pulledInstance();
    pulled.clock.time = Date.parse("2026-10-05T09:00:00Z");
    await expect(pulled.incremental()).rejects.toMatchObject({ code: "watermark-in-future" });
  });

  it("accepts a watermark within a few minutes of the instance's clock", async () => {
    const pulled = await pulledInstance();
    pulled.clock.time = Date.parse("2026-10-05T09:57:00Z");
    const { summary } = await pulled.incremental();
    expect(summary.changedSources).toEqual([]);
  });
});
