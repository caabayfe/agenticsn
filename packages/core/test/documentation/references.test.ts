import { describe, expect, it } from "bun:test";
import { type DocPage, parseDocPage, referencesOf, resolveReference } from "@snagentic/core";

const page = (path: string): DocPage =>
  parseDocPage(path, { frontMatter: { title: path }, body: "" });

const PAGES = [
  page("processes/incident/operate/escalate.md"),
  page("processes/incident/use/report.md"),
  page("processes/problem/understand/overview.md"),
  page("processes/problem/operate/raise.md"),
  page("processes/problem/configure/raise.md"),
  page("processes/problem/use/raise.md"),
];
const PROCESSES = ["incident", "problem"];

describe("links between pages", () => {
  it("finds see: links in prose, not in code", () => {
    expect(
      referencesOf(
        "See [raising a problem](see:problem/raise) and [this](see:report).\n`[x](see:code)`",
      ),
    ).toEqual(["problem/raise", "report"]);
  });

  it("resolves a topic to the page in the reader's own section first", () => {
    const fromOperate = { process: "incident", section: "operate" } as const;
    const fromUse = { process: "incident", section: "use" } as const;
    expect(resolveReference("problem/raise", fromOperate, PAGES, PROCESSES)).toMatchObject({
      kind: "page",
      page: { path: "processes/problem/operate/raise.md" },
    });
    expect(resolveReference("problem/raise", fromUse, PAGES, PROCESSES)).toMatchObject({
      page: { path: "processes/problem/use/raise.md" },
    });
  });

  it("resolves a topic of the same process, a named section, and a process", () => {
    const from = { process: "incident", section: "operate" } as const;
    expect(resolveReference("report", from, PAGES, PROCESSES)).toMatchObject({
      page: { path: "processes/incident/use/report.md" },
    });
    expect(resolveReference("problem/configure/raise", from, PAGES, PROCESSES)).toMatchObject({
      page: { path: "processes/problem/configure/raise.md" },
    });
    expect(resolveReference("problem", from, PAGES, PROCESSES)).toEqual({
      kind: "process",
      process: "problem",
    });
    expect(resolveReference("problem/overview", from, PAGES, PROCESSES)).toMatchObject({
      page: { path: "processes/problem/understand/overview.md" },
    });
  });

  it("resolves nothing for an unknown process, topic or section", () => {
    const from = { process: "incident", section: "operate" } as const;
    for (const target of ["change/raise", "problem/close", "problem/use/close", "nothing", ""]) {
      expect(resolveReference(target, from, PAGES, PROCESSES)).toBeNull();
    }
  });
});
