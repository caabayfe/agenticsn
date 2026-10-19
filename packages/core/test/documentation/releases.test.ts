import { describe, expect, it } from "bun:test";
import {
  type DocPage,
  newNotes,
  notedPages,
  parseRelease,
  repinnedPages,
  unknownReleasePages,
} from "@snagentic/core";

const page = (path: string, hashes: Record<string, string | undefined>): DocPage => {
  const [, process = "", section = "use", file = ""] = path.split("/");
  return {
    path,
    process,
    section: section as DocPage["section"],
    topic: file.replace(".md", ""),
    title: file,
    evidence: Object.entries(hashes).map(([id, hash]) => ({
      kind: "record",
      id,
      how: "read",
      result: "ok",
      table: "sys_script",
      sysId: "a1",
      ...(hash === undefined ? {} : { hash }),
    })),
    body: "",
  };
};

const REPORT = page("processes/incident/use/report.md", { E01: "h1", E02: "h2" });
const ASSIGN = page("processes/incident/operate/assign.md", { E01: "h3" });

const SOURCE = {
  frontMatter: {
    title: "October 2026",
    date: "2026-10-18",
    notes: [
      {
        for: "employees",
        note: "You can no longer attach files when you report an incident.",
        see: ["incident/report"],
      },
      { for: "it", note: "Assignment rules run before insert.", see: ["incident/operate/assign"] },
    ],
  },
  body: "The first release of the guide.\n",
};

describe("release notes (ADR-0039, decision 6)", () => {
  it("reads a release file: its title, date, intro and notes, each for employees or IT", () => {
    expect(parseRelease("changes/2026-10.md", SOURCE)).toEqual({
      path: "changes/2026-10.md",
      title: "October 2026",
      date: "2026-10-18",
      intro: "The first release of the guide.\n",
      notes: [
        {
          guide: "employees",
          note: "You can no longer attach files when you report an incident.",
          see: ["incident/report"],
        },
        {
          guide: "it",
          note: "Assignment rules run before insert.",
          see: ["incident/operate/assign"],
        },
      ],
    });
  });

  it("refuses a release without a title, a date, or notes it can read", () => {
    const bad = (frontMatter: unknown) => () =>
      parseRelease("changes/x.md", { frontMatter, body: "" });
    expect(bad({ date: "2026-10-18", notes: [] })).toThrow(/title/);
    expect(bad({ title: "X", date: "18/10/2026", notes: [] })).toThrow(/date/);
    expect(bad({ title: "X", date: "2026-10-18", notes: [{ for: "boss", note: "n" }] })).toThrow(
      /employees or it/,
    );
    expect(bad({ title: "X", date: "2026-10-18", notes: [{ for: "it" }] })).toThrow(/note/);
  });

  it("fails a note that links a page that doesn't exist", () => {
    const release = parseRelease("changes/2026-10.md", {
      ...SOURCE,
      frontMatter: {
        ...SOURCE.frontMatter,
        notes: [{ for: "it", note: "n", see: ["incident/report", "incident/nothing"] }],
      },
    });
    expect(unknownReleasePages([release], [REPORT, ASSIGN], ["incident"])).toEqual([
      { path: "changes/2026-10.md", target: "incident/nothing" },
    ]);
  });

  it("finds pages re-pinned to a new hash, and the notes added since the base", () => {
    const before = [REPORT, ASSIGN];
    const now = [
      page("processes/incident/use/report.md", { E01: "h1", E02: "changed", E03: "new" }),
      page("processes/incident/operate/assign.md", { E01: undefined }),
    ];
    expect(repinnedPages(now, before)).toEqual([{ page: now[0] as DocPage, evidence: ["E02"] }]);
    const release = parseRelease("changes/2026-10.md", SOURCE);
    const old = { ...release, notes: release.notes.slice(1) };
    const added = newNotes([release], [old]);
    expect(added.map((note) => note.guide)).toEqual(["employees"]);
    expect(newNotes([release], [])).toHaveLength(2);
    expect(notedPages(added, [REPORT, ASSIGN], ["incident"])).toEqual(
      new Set(["processes/incident/use/report.md"]),
    );
  });
});
