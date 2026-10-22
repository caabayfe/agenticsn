import { describe, expect, it } from "bun:test";
import { buildSite } from "@snagentic/core";
import { ALL, fakeSources, NO_MEDIA, pages, run, SITE, withPage } from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/confirm"],
  tasks: [{ title: "Something is broken", pages: ["incident/report", "incident/confirm"] }],
};

const QUESTIONS = {
  questions: [
    {
      id: "Q01",
      ask: "Should agents see the Unassigned list first?",
      kind: "decide",
      who: "owner",
    },
    {
      id: "Q02",
      ask: "What does the list show at night?",
      kind: "check",
      who: "agent",
      after: ["Q01"],
    },
    {
      id: "Q03",
      ask: "Is the survey sent?",
      kind: "hidden",
      who: "platform",
      status: "answered",
      answer: "Yes, to every caller.",
      by: "platform team",
      on: "2026-10-20",
    },
  ],
};

const LIST = ALL.map((page) => {
  if (page.path === pages.assign.path) {
    return withPage(page, {
      body: "## Who gets the incident\n\nOpen the Unassigned list. [E01] [Q01] [Q02]\n\n{{animation:asg}}\n",
    });
  }
  if (page.path === pages.confirm.path) {
    return withPage(page, { body: "Accept it. [E01] [Q01]\n\n{{animation:asg}}\n" });
  }
  return page;
});

async function build(site: unknown = { ...SITE, employees: GUIDE }) {
  const { sources } = fakeSources(LIST, {
    site,
    questions: [{ path: "processes/incident/questions.yaml", questions: QUESTIONS }],
    features: [
      {
        path: "processes/incident/features.yaml",
        features: {
          features: [
            { id: "chat", title: "Chat", found: ["global"], status: "question", question: "Q01" },
          ],
        },
      },
    ],
  });
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
  return (path: string) => String(written.find((item) => item.path === path)?.content ?? "");
}

describe("docs build: questions", () => {
  it("links a page's question citations to the tracker and lists its open questions after the text", async () => {
    const page = (await build())("processes/incident/operate/assign.html");
    expect(page).toContain(
      '<a class="cite question" href="../../../it/open-questions.html#incident-Q01">Q01</a>',
    );
    expect(page).toContain('<h2 id="questions">Open questions');
    expect(page).toContain("Should agents see the Unassigned list first?");
    expect(page).toContain("Decision, for the process owner");
    expect(page).toContain("Check on screen, for Service desk agent");
  });

  it("keeps questions off the employee guide", async () => {
    const page = (await build())("processes/incident/use/confirm.html");
    expect(page).not.toContain("Q01");
    expect(page).not.toContain("Should agents see");
  });

  it("tracks each question once, by who answers it, with the pages it holds back", async () => {
    const tracker = (await build())("it/open-questions.html");
    expect(tracker).toContain("2 open questions");
    expect(tracker).toContain("2 open, 1 answered or dropped");
    expect(tracker).toContain("<h3>For the process owner (1)</h3>");
    expect(tracker).toContain('id="incident-Q01"');
    expect(tracker).toContain(
      'href="../processes/incident/operate/assign.html">Assign an incident</a>',
    );
    expect(tracker).toContain('Holds back <a href="#incident-Q02">Q02</a>');
    expect(tracker).toContain('Waits on <a href="#incident-Q01">Q01</a>');
    expect(tracker).toContain("<strong>Answer:</strong> Yes, to every caller.");
    expect(tracker.match(/id="incident-Q01"/g)?.length).toBe(1);
  });

  it("counts open questions on the process card and shows a feature's question", async () => {
    const file = await build();
    expect(file("it/index.html")).toContain("2 open questions.");
    expect(file("processes/incident/index.html")).toContain(
      'href="../../it/open-questions.html#incident-Q01">Q01</a>: Should agents see the Unassigned list first?',
    );
  });

  it("names a question without a link when the site has no tracker", async () => {
    const page = (await build(SITE))("processes/incident/operate/assign.html");
    expect(page).toContain('<span class="cite question">Q01</span>');
  });
});
