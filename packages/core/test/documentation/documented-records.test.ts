import { describe, expect, it } from "bun:test";
import { type DocumentationHistory, documentationLookup, type PageSource } from "@snagentic/core";
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
        title: "Resolve an incident",
        evidence: ["E01"],
        claims: [{ heading: "Resolve an incident", reader: "operators", text: "Choose Resolve." }],
      },
      {
        table: "sys_script",
        sysId: RULE,
        page: `documentation/${pages.configureAssign.path}`,
        title: "Assignment configuration",
        evidence: ["E01"],
        claims: [
          {
            heading: "Assignment configuration",
            reader: "platform",
            text: "The rule sets the group.",
          },
        ],
      },
      {
        table: "sys_ui_action",
        sysId: ACTION,
        page: `documentation/${pages.configureResolve.path}`,
        title: "Resolution configuration",
        evidence: ["E01"],
        claims: [
          {
            heading: "Resolution configuration",
            reader: "platform",
            text: "The action sets the state.",
          },
        ],
      },
    ]);
  });

  it("leaves out evidence on a field the change doesn't touch (ADR-0039)", async () => {
    const { sources } = fakeSources(ALL);
    const lookup = documentationLookup({ ...run, sources });
    const rule = { table: "sys_script", sysId: RULE };
    expect(await lookup.citing([{ ...rule, changed: ["condition"] }], run.signal)).toEqual([]);
    const script = await lookup.citing([{ ...rule, changed: ["condition", "script"] }], run.signal);
    expect(script.map((item) => item.evidence)).toEqual([["E01"]]);
    const action = { table: "sys_ui_action", sysId: ACTION, changed: ["order"] };
    expect(await lookup.citing([action], run.signal)).toHaveLength(2);
  });

  it("lists evidence the mirror no longer matches", async () => {
    const { sources } = fakeSources(ALL);
    const lookup = documentationLookup({ ...run, sources, mirror: () => fakeMirror({}) });
    const stale = await lookup.stale(run.signal);
    expect(stale).toHaveLength(5);
    expect(stale[0]).toEqual({
      page: `documentation/${pages.report.path}`,
      evidence: "E01",
      title: "Report an incident",
      anchor: expect.stringContaining("sc_cat_item_producer/"),
      status: "missing",
      claims: [
        {
          heading: "Report an incident",
          reader: "employees",
          text: "Open Employee Center and choose Report an issue.",
        },
      ],
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

describe("documentation lookup: pages pinned again without a release note (ADR-0039)", () => {
  const repinned = {
    ...pages.resolve,
    frontMatter: {
      ...pages.resolve.frontMatter,
      evidence: { E01: { ...pages.resolve.frontMatter.evidence.E01, hash: "a2" } },
    },
  };
  const release = (notes: unknown[]) => ({
    path: "changes/2026-10.md",
    frontMatter: { title: "October 2026", date: "2026-10-18", notes },
    body: "",
  });
  const NOTE = { for: "it", note: "Resolve now asks for a code.", see: ["incident/resolve"] };
  const history = (atBase: readonly PageSource[]): DocumentationHistory => ({
    changedSince: async () => [pages.resolve.path, "changes/2026-10.md"],
    at: async (_commit, paths) => atBase.filter((source) => paths.includes(source.path)),
  });
  const lookup = (releases: PageSource[], atBase: readonly PageSource[]) =>
    documentationLookup({
      ...run,
      sources: fakeSources([...ALL.filter((p) => p.path !== pages.resolve.path), repinned], {
        releases,
      }).sources,
      history: history(atBase),
    });

  it("names a page pinned to a new hash since base when no new note links it", async () => {
    const found = await lookup([release([])], [pages.resolve, release([])]).unnoted(
      "c0ffee",
      run.signal,
    );
    expect(found).toEqual([
      {
        page: `documentation/${pages.resolve.path}`,
        title: "Resolve an incident",
        evidence: ["E01"],
      },
    ]);
  });

  it("accepts the page once a note added since base links it, but not an old note", async () => {
    expect(
      await lookup([release([NOTE])], [pages.resolve, release([])]).unnoted("c0ffee", run.signal),
    ).toEqual([]);
    expect(
      await lookup([release([NOTE])], [pages.resolve, release([NOTE])]).unnoted(
        "c0ffee",
        run.signal,
      ),
    ).toHaveLength(1);
  });

  it("ignores pages that didn't parse at base, and needs a history to say anything", async () => {
    const broken = { ...pages.resolve, frontMatter: { evidence: {} } };
    expect(await lookup([], [broken]).unnoted("c0ffee", run.signal)).toEqual([]);
    const without = documentationLookup({ ...run, sources: fakeSources(ALL).sources });
    expect(await without.unnoted("c0ffee", run.signal)).toEqual([]);
  });
});
