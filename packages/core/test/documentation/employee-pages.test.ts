import { describe, expect, it } from "bun:test";
import { buildSite } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, pages, run, SITE, withPage } from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/confirm"],
  tasks: [{ title: "Something is broken", pages: ["incident/report", "incident/confirm"] }],
};

// The confirm page with a review label and an open question, as authors write them.
const CONFIRM = withPage(pages.confirm, {
  body: "## Close it {label=NEW}\n\nAccept it, or reject it with a reason. [E01]\n\n{{animation:asg}}\n\n## The survey {label=OPEN-QUESTION}\n\nNobody has seen the survey yet.\n\n## Tips\n\nReply to the email.\n",
});
const LIST = [...ALL.filter((page) => page.path !== pages.confirm.path), CONFIRM];

async function build() {
  const { sources } = fakeSources(LIST, { site: { ...SITE, employees: GUIDE } });
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
  const main = (path: string) => {
    const page = file(path);
    return page.slice(page.indexOf("<main"), page.indexOf("</main>"));
  };
  return { file, main };
}

describe("docs build: employee pages", () => {
  it("shows employees the steps without citations, review labels, evidence or open questions", async () => {
    const { main } = await build();
    const page = main("processes/incident/use/confirm.html");
    expect(page).toContain("Accept it, or reject it with a reason.");
    expect(page).toContain("## Close it\n");
    expect(page).not.toContain("[E01]");
    expect(page).not.toContain('class="cite"');
    expect(page).not.toContain("label-new");
    expect(page).not.toContain("How this page was checked");
    expect(page).not.toContain("Nobody has seen the survey yet.");
    expect(page).toContain("## Tips");
    expect(page).toContain("Last checked 2026-10-17");
    expect(page).not.toContain("mirror");
    expect(page).not.toContain('class="num"');
  });

  it("leads employees to the next page in the guide's order, not the process's", async () => {
    const { main } = await build();
    const page = main("processes/incident/use/confirm.html");
    expect(page).toContain(
      'rel="next" href="../../../processes/incident/use/report.html">Report an incident →',
    );
  });

  it("gives a process in the employee guide its plain title and what employees can do", async () => {
    const { main } = await build();
    const home = main("processes/incident/use/index.html");
    expect(home).toContain("<h1>Incident management</h1>");
    expect(home).not.toContain("Who this is for");
    expect(home).toContain("Report an incident");
  });

  it("collects every open question on one page of the IT guide, linked to its page", async () => {
    const { file, main } = await build();
    const questions = main("it/open-questions.html");
    expect(questions).toContain("<h1>Open questions</h1>");
    expect(questions).toContain("<h2>Incident management</h2><h3>The survey</h3>");
    expect(questions).toContain(
      'href="../processes/incident/use/confirm.html">Confirm or reopen the fix</a>',
    );
    expect(questions).toContain("Nobody has seen the survey yet.");
    expect(file("processes/incident/operate/assign.html")).toContain(">Open questions (1)</a>");
  });

  it("names the guide once on operator pages: in the menu and the breadcrumb, not the banner", async () => {
    const { file } = await build();
    const page = file("processes/incident/operate/resolve.html");
    expect(page).not.toContain('<span class="kind">Operator guide</span>');
    expect(page).toContain(
      'it/index.html">IT guide</a> › <a href="../../../processes/incident/index.html">Incident management</a></nav>',
    );
    expect(page).toContain("On the employee's side (Employee guide)");
  });
});
