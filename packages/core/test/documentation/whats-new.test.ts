import { describe, expect, it } from "bun:test";
import { buildSite, checkDocs } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, run, SITE } from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/report"],
  tasks: [{ title: "Something is broken", summary: "Report it.", pages: ["incident/confirm"] }],
};

const release = (path: string, title: string, date: string, notes: unknown[], body = "") => ({
  path,
  frontMatter: { title, date, notes },
  body,
});

const RELEASES = [
  release("changes/2026-09.md", "September 2026", "2026-09-30", [
    { for: "it", note: "Resolve asks for a close code.", see: ["incident/operate/resolve"] },
  ]),
  release(
    "changes/2026-10.md",
    "October 2026",
    "2026-10-18",
    [
      {
        for: "employees",
        note: "You can no longer attach files <b>here</b>.",
        see: ["incident/report"],
      },
      {
        for: "it",
        note: "Assignment rules run before insert.",
        see: ["incident/configure/assign"],
      },
    ],
    "A smaller form.\n",
  ),
];

async function build(employees: unknown = GUIDE, releases = RELEASES) {
  const site = employees === null ? SITE : { ...SITE, employees };
  const { sources } = fakeSources(ALL, { site, releases });
  let written: readonly { path: string; content: string | Uint8Array }[] = [];
  await buildSite({
    ...run,
    sources,
    markdown: { html: (md) => `<md>${md}</md>` },
    output: {
      root: "/ws/site",
      replace: async (files) => {
        written = files;
      },
    },
    media: NO_MEDIA,
  });
  const file = (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
  return { file, written };
}

describe("docs build: What's new (ADR-0039)", () => {
  it("lists the employee notes in the employee guide, newest release first, linked to the pages", async () => {
    const { file } = await build();
    const page = file("employees/whats-new.html");
    expect(page).toContain("<h1>What's new</h1>");
    expect(page).toContain("October 2026");
    expect(page).toContain("<md>A smaller form.\n</md>");
    expect(page).toContain("You can no longer attach files &lt;b&gt;here&lt;/b&gt;.");
    expect(page).toContain('href="../processes/incident/use/report.html">Report an incident</a>');
    expect(page).not.toContain("Assignment rules run before insert.");
    expect(page).not.toContain("September 2026");
    expect(file("processes/incident/use/confirm.html")).toContain(
      'href="../../../employees/whats-new.html">What\'s new</a>',
    );
  });

  it("lists every note in the IT guide, marking the ones for employees", async () => {
    const { file } = await build();
    const page = file("it/whats-new.html");
    expect(page.indexOf("October 2026")).toBeLessThan(page.indexOf("September 2026"));
    expect(page).toContain('<span class="label label-new">For employees</span>');
    expect(page).toContain("Resolve asks for a close code.");
    expect(page).toContain(
      'href="../processes/incident/configure/assign.html">Assignment configuration</a>',
    );
    expect(file("processes/incident/operate/assign.html")).toContain(
      'href="../../../it/whats-new.html">What\'s new</a>',
    );
  });

  it("has no What's new pages without release notes, and one page in a site with one guide", async () => {
    const none = await build(GUIDE, []);
    expect(none.written.some((item) => item.path.endsWith("whats-new.html"))).toBe(false);
    expect(none.file("processes/incident/use/confirm.html")).not.toContain("whats-new");
    const single = await build(null);
    expect(single.file("it/whats-new.html")).toContain("You can no longer attach files");
    expect(single.written.some((item) => item.path === "employees/whats-new.html")).toBe(false);
  });

  it("fails docs check on a note linking a page that doesn't exist", async () => {
    const broken = [
      release("changes/x.md", "X", "2026-10-01", [
        { for: "it", note: "n", see: ["incident/nope"] },
      ]),
    ];
    const { sources } = fakeSources(ALL, { releases: broken });
    const check = await checkDocs({ ...run, sources });
    expect(check.ok).toBe(false);
    expect(check.problems).toContainEqual({
      kind: "unknown-release-page",
      severity: "error",
      page: "changes/x.md",
      detail: "see:incident/nope",
    });
  });
});
