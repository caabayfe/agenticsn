import { describe, expect, it } from "bun:test";
import { documentationLookup } from "@snagentic/core";
import { ACTION, ALL, fakeMirror, fakeSources, pages, RULE, run } from "../support/docs-fixtures";

describe("documentation lookup for validate", () => {
  it("lists the pages citing each record, with the evidence ids, workspace-relative", async () => {
    const { sources } = fakeSources(ALL);
    const lookup = documentationLookup({ ...run, sources });
    const found = await lookup.citing(
      [
        { table: "sys_ui_action", sysId: ACTION },
        { table: "sys_script", sysId: RULE },
        { table: "sys_script", sysId: "ffff0000000000000000000000000000" },
      ],
      run.signal,
    );
    expect(found).toEqual([
      {
        table: "sys_ui_action",
        sysId: ACTION,
        page: `documentation/${pages.resolve.path}`,
        evidence: ["E01"],
      },
      {
        table: "sys_script",
        sysId: RULE,
        page: `documentation/${pages.configureAssign.path}`,
        evidence: ["E01"],
      },
      {
        table: "sys_ui_action",
        sysId: ACTION,
        page: `documentation/${pages.configureResolve.path}`,
        evidence: ["E01"],
      },
    ]);
  });

  it("lists evidence the mirror no longer matches", async () => {
    const { sources } = fakeSources(ALL);
    const lookup = documentationLookup({ ...run, sources, mirror: () => fakeMirror({}) });
    const stale = await lookup.stale(run.signal);
    expect(stale).toHaveLength(5);
    expect(stale[0]).toEqual({
      page: `documentation/${pages.report.path}`,
      evidence: "E01",
      anchor: expect.stringContaining("sc_cat_item_producer/"),
      status: "missing",
    });
    expect(await documentationLookup({ ...run, sources }).stale(run.signal)).toEqual([]);
  });

  it("lists the guides that have no animation", async () => {
    const { sources } = fakeSources([
      ...ALL.filter((page) => page.path !== pages.resolve.path),
      { ...pages.resolve, body: "Choose Resolve. [E01]" },
    ]);
    expect(await documentationLookup({ ...run, sources }).unanimated(run.signal)).toEqual([
      `documentation/${pages.resolve.path}`,
    ]);
    expect(
      await documentationLookup({ ...run, sources: fakeSources(ALL).sources }).unanimated(
        run.signal,
      ),
    ).toEqual([]);
  });

  it("finds nothing in a workspace without documentation, and passes other errors on", async () => {
    const { sources } = fakeSources([], { site: null });
    const lookup = documentationLookup({ ...run, sources });
    expect(await lookup.citing([{ table: "sys_script", sysId: RULE }], run.signal)).toEqual([]);
    expect(await lookup.stale(run.signal)).toEqual([]);
    expect(await lookup.unanimated(run.signal)).toEqual([]);
    const broken = fakeSources([], { site: { title: "no instance" } }).sources;
    await expect(
      documentationLookup({ ...run, sources: broken }).stale(run.signal),
    ).rejects.toThrow(/needs title and instance/);
  });
});
