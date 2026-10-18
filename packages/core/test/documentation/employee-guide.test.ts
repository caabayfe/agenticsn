import { describe, expect, it } from "bun:test";
import { buildSite, checkDocs } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, run, SITE } from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/report"],
  tasks: [
    {
      title: "Something is broken",
      summary: "Report it and follow it to the fix.",
      pages: ["incident/report", "incident/confirm"],
    },
  ],
};

const site = (employees: unknown) => (employees === null ? SITE : { ...SITE, employees });

async function build(employees: unknown = GUIDE) {
  const { sources } = fakeSources(ALL, { site: site(employees) });
  let written: readonly { path: string; content: string | Uint8Array }[] = [];
  await buildSite({
    ...run,
    sources,
    markdown: { html: (md) => `<md>${md}</md>` },
    output: {
      root: "/ws/.snagentic/site",
      replace: async (files) => {
        written = files;
      },
    },
    media: NO_MEDIA,
  });
  const file = (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
  return { written, file };
}

describe("docs build: an employee guide and an IT guide", () => {
  it("opens the site on a map of both guides, and lists the processes in the IT guide", async () => {
    const { file, written } = await build();
    const front = file("index.html");
    expect(front).toContain('<h2><a href="employees/index.html">Employee guide</a></h2>');
    expect(front).toContain('<h2><a href="it/index.html">IT guide</a></h2>');
    expect(file("it/index.html")).toContain(
      '<a href="../processes/incident/index.html">Incident management</a>',
    );
    expect(written.map((item) => item.path)).toContain("employees/index.html");
  });

  it("organises the employee home by what employees want to do, then how each process works", async () => {
    const { file } = await build();
    const home = file("employees/index.html");
    expect(home).toContain("<h1>Employee guide</h1>");
    expect(home).toContain("How to get help from IT.");
    expect(home).toContain("<h2>Start here</h2>");
    expect(home).toContain(
      '<a href="../processes/incident/use/report.html">Report an incident</a>',
    );
    expect(home).toContain("<h2>Something is broken</h2>");
    expect(home).toContain("Report it and follow it to the fix.");
    expect(home).toContain(
      '<a href="../processes/incident/use/confirm.html">Confirm or reopen the fix</a><br><span class="mute">Say whether it works.</span>',
    );
    expect(home).toContain("<h2>How it works</h2>");
    expect(home).toContain(
      '<a href="../processes/incident/use/understand/overview.html">How incident management works</a>',
    );
    expect(home).not.toContain("Assign an incident");
  });

  it("keeps employees in their guide: its breadcrumbs, no operator side, no configuration", async () => {
    const { file } = await build();
    for (const path of [
      "processes/incident/use/confirm.html",
      "processes/incident/use/understand/overview.html",
      "processes/incident/use/index.html",
    ]) {
      const page = file(path);
      expect(page).toContain('employees/index.html">Employee guide</a>');
      expect(page).not.toContain('href="../../../processes/incident/index.html"');
    }
    const confirm = file("processes/incident/use/confirm.html");
    expect(confirm).not.toContain("On the other side");
    expect(confirm).not.toContain("How it is configured");
  });

  it("puts the operators' and platform team's pages in the IT guide", async () => {
    const { file } = await build();
    expect(file("processes/incident/operate/resolve.html")).toContain(
      'it/index.html">IT guide</a> › <a href="../../../processes/incident/index.html">Incident management</a>',
    );
    expect(file("processes/incident/configure/resolve.html")).toContain(
      'it/index.html">IT guide</a>',
    );
    expect(file("processes/incident/index.html")).toContain('it/index.html">IT guide</a>');
  });

  it("opens a process in the IT guide on what operators do, without asking which reader you are", async () => {
    const { file } = await build();
    const page = file("processes/incident/index.html");
    const main = page.slice(page.indexOf("<main>"), page.indexOf("</main>"));
    expect(main).not.toContain('class="door"');
    expect(main).not.toContain("For end users");
    expect(main).toContain("<h2>What you can do</h2>");
    expect(main).toContain(
      'href="../../processes/incident/operate/assign.html">Assign an incident</a>',
    );
    expect(main).not.toContain("Confirm or reopen the fix");
    expect(main).toContain(
      'href="../../processes/incident/configure/index.html">How it is configured</a>',
    );
    expect(main).toContain("<strong>In Progress</strong><span>someone is working on it</span>");
  });

  it("keeps the single site, and its links, when there is no employee guide", async () => {
    const { file, written } = await build(null);
    expect(file("index.html")).toContain('<a href="processes/incident/index.html">');
    expect(written.map((item) => item.path)).not.toContain("employees/index.html");
    expect(file("processes/incident/use/confirm.html")).toContain("On the other side");
  });
});

describe("docs check: the employee guide", () => {
  it("fails a guide entry that isn't an employee page", async () => {
    const { sources } = fakeSources(ALL, {
      site: site({ ...GUIDE, start: ["incident/assign", "incident/nothing", "incident/overview"] }),
    });
    const check = await checkDocs({ ...run, sources });
    expect(check.ok).toBe(false);
    const found = check.problems.filter((problem) => problem.kind === "unknown-guide-page");
    expect(found).toEqual([
      {
        kind: "unknown-guide-page",
        severity: "error",
        page: "site.yaml",
        detail: "incident/assign",
      },
      {
        kind: "unknown-guide-page",
        severity: "error",
        page: "site.yaml",
        detail: "incident/nothing",
      },
    ]);
  });

  it("refuses an employee guide without a title", async () => {
    const { sources } = fakeSources(ALL, { site: site({ start: ["incident/report"] }) });
    await expect(checkDocs({ ...run, sources })).rejects.toThrow("employees needs title");
  });
});
