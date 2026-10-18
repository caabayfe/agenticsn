import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  anchorHash,
  anchorOf,
  citationsOf,
  DocumentationSourceError,
  evidenceStatus,
  pageProblems,
  parseDocPage,
  type RecordEvidence,
  type SeenEvidence,
  seenStatus,
  splitFrontMatter,
} from "@snagentic/core";

const SYS_ID = "9f1c0000000000000000000000000001";

function technical(evidence: unknown, body = "Text. [E01]") {
  return parseDocPage("processes/triage/configure/route.md", {
    frontMatter: {
      title: "Triage case configuration",
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

  it("reads a configure page and its evidence", () => {
    const page = technical({
      E01: {
        record: `sys_script_include/${SYS_ID}`,
        field: "script",
        hash: "ab12",
        how: "read createDefaultInteraction",
        result: "one user gives the contact",
      },
    });
    expect(page.process).toBe("triage");
    expect(page.section).toBe("configure");
    expect(page.topic).toBe("route");
    expect(page.evidence).toEqual([
      {
        kind: "record",
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

  it("refuses a page outside processes/<process>/<section>/<topic>.md, naming the file", () => {
    for (const path of [
      "pages/x.md",
      "processes/x/y.guide.md",
      "processes/x/manage/y.md",
      "processes/X/use/y.md",
    ]) {
      expect(() => parseDocPage(path, { frontMatter: { title: "X" }, body: "" })).toThrow(
        DocumentationSourceError,
      );
    }
    expect(() => parseDocPage("pages/x.md", { frontMatter: { title: "X" }, body: "" })).toThrow(
      /pages\/x\.md/,
    );
  });

  it("reads the section and topic from the path", () => {
    for (const section of ["understand", "use", "operate", "configure"]) {
      const page = parseDocPage(`processes/incident/${section}/assign.md`, {
        frontMatter: { title: "Assign an incident" },
        body: "",
      });
      expect(page).toMatchObject({ process: "incident", section, topic: "assign" });
    }
  });

  it("reads seen evidence: who checked the screen, when and where", () => {
    const page = technical({
      E01: {
        seen: {
          by: "A. Reviewer",
          on: new Date("2026-10-17"),
          where: "Employee Center › Get help",
        },
        how: "opened the menu",
        result: "reads Get help",
      },
    });
    expect(page.evidence).toEqual([
      {
        kind: "seen",
        id: "E01",
        by: "A. Reviewer",
        on: "2026-10-17",
        where: "Employee Center › Get help",
        how: "opened the menu",
        result: "reads Get help",
      },
    ]);
  });

  it("refuses seen evidence without who, a date or where", () => {
    expect(() => technical({ E01: { seen: { by: "A", on: "17 Oct", where: "portal" } } })).toThrow(
      /seen needs by, on/,
    );
  });

  it("anchors evidence to a record's children, but not to a field and children at once", () => {
    const page = technical({
      E01: {
        record: `sys_ui_section/${SYS_ID}`,
        children: "sys_ui_element",
        how: "h",
        result: "r",
      },
    });
    expect(page.evidence[0]).toMatchObject({ children: "sys_ui_element" });
    expect(() =>
      technical({
        E01: { record: `sys_ui_section/${SYS_ID}`, field: "x", children: "sys_ui_element" },
      }),
    ).toThrow(/a field or children/);
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
      { kind: "unknown-citation", page: "processes/triage/configure/route.md", detail: "E07" },
    ]);
  });

  it("reports evidence that no sentence cites", () => {
    expect(pageProblems(technical(evidence, "No citation."))).toEqual([
      { kind: "uncited-evidence", page: "processes/triage/configure/route.md", detail: "E01" },
    ]);
  });

  it("reports a configure page without evidence", () => {
    expect(pageProblems(technical(undefined, "Text."))).toEqual([
      { kind: "no-evidence", page: "processes/triage/configure/route.md", detail: "route" },
    ]);
  });

  it("accepts a user guide without evidence", () => {
    const guide = parseDocPage("processes/triage/use/route.md", {
      frontMatter: { title: "Triage cases" },
      body: "Steps.",
    });
    expect(pageProblems(guide)).toEqual([]);
  });

  it("reports a label outside a heading, where it would be printed as written", () => {
    const page = parseDocPage("processes/triage/use/route.md", {
      frontMatter: { title: "T" },
      body: "## Fine {label=NEW}\nText. {label=OPEN-QUESTION}\n`{label=NEW}` in code\n",
    });
    expect(pageProblems(page)).toEqual([
      { kind: "misplaced-label", page: "processes/triage/use/route.md", detail: "OPEN-QUESTION" },
    ]);
  });

  it("allows reader marks only on shared pages, and only for users and operators", () => {
    const page = (section: string, body: string) =>
      parseDocPage(`processes/triage/${section}/route.md`, { frontMatter: { title: "T" }, body });
    expect(pageProblems(page("understand", "## A {for=user}\n## B {for=operator}\n"))).toEqual([]);
    expect(pageProblems(page("use", "## A {for=operator}\n"))).toEqual([
      { kind: "misplaced-view", page: "processes/triage/use/route.md", detail: "operator" },
    ]);
    expect(pageProblems(page("understand", "## A {for=admin}\n"))).toEqual([
      { kind: "unknown-view", page: "processes/triage/understand/route.md", detail: "admin" },
    ]);
  });
});

describe("evidence status", () => {
  const base: RecordEvidence = {
    kind: "record",
    id: "E01",
    table: "sys_script",
    sysId: SYS_ID,
    how: "h",
    result: "r",
  };
  const seen: SeenEvidence = {
    kind: "seen",
    id: "E02",
    by: "A. Reviewer",
    on: "2026-07-01",
    where: "Employee Center",
    how: "h",
    result: "r",
  };

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

  it("is seen for 90 days after a person checked the screen, then asks for a recheck", () => {
    expect(seenStatus(seen, "2026-09-29")).toBe("seen");
    expect(seenStatus(seen, "2026-09-30")).toBe("recheck");
    expect(anchorOf(seen)).toBe("seen by A. Reviewer on 2026-07-01: Employee Center");
  });

  it("hashes a children file when the evidence anchors the children", () => {
    const evidence: RecordEvidence = { ...base, children: "sys_ui_element" };
    const record = { hash: "h", fields: {}, children: { sys_ui_element: "- element: state\n" } };
    expect(anchorHash(evidence, record)).toBe(
      createHash("sha256").update("- element: state\n").digest("hex"),
    );
    expect(anchorHash(evidence, { hash: "h", fields: {} })).toBeNull();
    expect(anchorOf(evidence)).toBe(`sys_script/${SYS_ID}#children.sys_ui_element`);
  });
});
