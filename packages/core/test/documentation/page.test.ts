import { describe, expect, it } from "bun:test";
import {
  citationsOf,
  DocumentationSourceError,
  evidenceStatus,
  pageProblems,
  parseDocPage,
  splitFrontMatter,
} from "@snagentic/core";

const SYS_ID = "9f1c0000000000000000000000000001";

function technical(evidence: unknown, body = "Text. [E01]") {
  return parseDocPage("pages/B4-triage.md", {
    frontMatter: {
      code: "B4",
      title: "Triage case configuration",
      audience: "technical",
      pair: "A4",
      reviewed: "2026-10-17",
      evidence,
    },
    body,
  });
}

describe("page sources", () => {
  it("separates the YAML front matter from the Markdown body", () => {
    const split = splitFrontMatter("---\ncode: A4\n---\n# Title\n\nText\n");
    expect(split).toEqual({ frontMatter: "code: A4\n", body: "# Title\n\nText\n" });
  });

  it("treats a file without front matter as body only", () => {
    expect(splitFrontMatter("# Title\n")).toEqual({ frontMatter: null, body: "# Title\n" });
  });

  it("reads a technical page and its evidence", () => {
    const page = technical({
      E01: {
        record: `sys_script_include/${SYS_ID}`,
        field: "script",
        hash: "ab12",
        how: "read createDefaultInteraction",
        result: "one user gives the contact",
      },
    });
    expect(page.code).toBe("B4");
    expect(page.audience).toBe("technical");
    expect(page.pair).toBe("A4");
    expect(page.evidence).toEqual([
      {
        id: "E01",
        table: "sys_script_include",
        sysId: SYS_ID,
        field: "script",
        hash: "ab12",
        how: "read createDefaultInteraction",
        result: "one user gives the contact",
      },
    ]);
  });

  it("refuses a page whose audience is neither guide nor technical, naming the file", () => {
    expect(() =>
      parseDocPage("pages/x.md", {
        frontMatter: { code: "X", title: "X", audience: "manager" },
        body: "",
      }),
    ).toThrow(DocumentationSourceError);
    expect(() =>
      parseDocPage("pages/x.md", {
        frontMatter: { code: "X", title: "X", audience: "manager" },
        body: "",
      }),
    ).toThrow(/pages\/x\.md/);
  });

  it("refuses evidence whose record is not <table>/<sys_id>", () => {
    expect(() => technical({ E01: { record: "incident", how: "h", result: "r" } })).toThrow(
      /E01.*<table>\/<sys_id>/,
    );
  });

  it("refuses evidence ids that are not E followed by digits", () => {
    expect(() =>
      technical({ X1: { record: `sys_script/${SYS_ID}`, how: "h", result: "r" } }),
    ).toThrow(/X1/);
  });
});

describe("citations", () => {
  it("finds every cited evidence id once, in order", () => {
    expect(citationsOf("A [E02] and [E01], again [E02]. [e3] is not one.")).toEqual(["E02", "E01"]);
  });

  it("ignores citations inside code", () => {
    expect(citationsOf("`[E09]`\n\n```\n[E08]\n```\n[E01]")).toEqual(["E01"]);
  });
});

describe("page problems", () => {
  const evidence = { E01: { record: `sys_script/${SYS_ID}`, how: "h", result: "r" } };

  it("reports a citation of evidence the page does not list", () => {
    expect(pageProblems(technical(evidence, "[E01] [E07]"))).toEqual([
      { kind: "unknown-citation", page: "pages/B4-triage.md", detail: "E07" },
    ]);
  });

  it("reports evidence that no sentence cites", () => {
    expect(pageProblems(technical(evidence, "No citation."))).toEqual([
      { kind: "uncited-evidence", page: "pages/B4-triage.md", detail: "E01" },
    ]);
  });

  it("reports a technical page without evidence", () => {
    expect(pageProblems(technical(undefined, "Text."))).toEqual([
      { kind: "no-evidence", page: "pages/B4-triage.md", detail: "B4" },
    ]);
  });

  it("accepts a user guide without evidence", () => {
    const guide = parseDocPage("pages/A4.md", {
      frontMatter: { code: "A4", title: "Triage cases", audience: "guide" },
      body: "Steps.",
    });
    expect(pageProblems(guide)).toEqual([]);
  });
});

describe("evidence status", () => {
  const base = { id: "E01", table: "sys_script", sysId: SYS_ID, how: "h", result: "r" };

  it("is fresh when the pinned hash matches the mirror", () => {
    expect(evidenceStatus({ ...base, hash: "aa" }, "aa")).toBe("fresh");
  });

  it("is changed when the mirror's hash differs", () => {
    expect(evidenceStatus({ ...base, hash: "aa" }, "bb")).toBe("changed");
  });

  it("is missing when the record is no longer in the mirror", () => {
    expect(evidenceStatus({ ...base, hash: "aa" }, null)).toBe("missing");
  });

  it("is unpinned when no hash was recorded yet", () => {
    expect(evidenceStatus(base, "bb")).toBe("unpinned");
  });
});
