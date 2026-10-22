import { describe, expect, it } from "bun:test";
import {
  buildSite,
  checkDocs,
  listQuestions,
  type PageSource,
  parseQuestions,
  possibleDuplicates,
} from "@snagentic/core";
import {
  ALL,
  fakeSources,
  NO_MEDIA,
  pages,
  RULE,
  run,
  SITE,
  withPage,
} from "../support/docs-fixtures";

const GUIDE = {
  title: "Employee guide",
  intro: "How to get help from IT.",
  start: ["incident/confirm"],
  tasks: [{ title: "Something is broken", pages: ["incident/report"] }],
};

const SMS = {
  id: "Q01",
  ask: "Is sending SMS about tasks wanted, with Notify switched on?",
  kind: "decide",
  who: "owner",
  about: [{ record: `sys_script/${RULE}` }],
};

const INCIDENT_PATH = "processes/incident/questions.yaml";

// The assignment page cites the shared question and its own one.
const LIST: readonly PageSource[] = ALL.map((page) =>
  page.path === pages.configureAssign.path
    ? withPage(page, { body: "The rule sets the group. [E01] [shared/Q01] [Q01]" })
    : page,
);

function sources(incident: unknown[], shared: unknown[] = [SMS], site: unknown = SITE) {
  return fakeSources(LIST, {
    site,
    questions: [
      { path: "questions.yaml", questions: { questions: shared } },
      { path: INCIDENT_PATH, questions: { questions: incident } },
    ],
  }).sources;
}

const kinds = async (incident: unknown[], shared?: unknown[]) =>
  (await checkDocs({ ...run, sources: sources(incident, shared) })).problems.map(
    (problem) => `${problem.kind} ${problem.detail}`,
  );

describe("questions shared across processes", () => {
  it("reads documentation/questions.yaml as the shared questions, cited shared/Q01", async () => {
    expect(parseQuestions("questions.yaml", { questions: [SMS] }).process).toBe("shared");
    const found = await kinds([{ ...SMS, ask: "Who approves a reassignment?", about: [] }]);
    expect(found.filter((kind) => kind.includes("question") || kind.includes("process"))).toEqual(
      [],
    );
  });

  it("warns that two questions in different files about the same record may be one", async () => {
    const found = await kinds([{ ...SMS, ask: "Should agents text callers?" }]);
    expect(found).toContain(
      `possible-duplicate shared/Q01 ~ incident/Q01: both are about sys_script/${RULE}`,
    );
  });

  it("warns about nearly the same wording, and stays quiet when marked distinct", async () => {
    const twin = { ...SMS, about: [] };
    expect(await kinds([twin])).toContain(
      "possible-duplicate shared/Q01 ~ incident/Q01: nearly the same wording",
    );
    expect(
      (await kinds([{ ...twin, distinct: ["shared/Q01"] }])).some((kind) =>
        kind.startsWith("possible-duplicate"),
      ),
    ).toBe(false);
  });

  it("refuses a distinct that names no question", async () => {
    expect(await kinds([{ ...SMS, ask: "Who approves?", about: [], distinct: ["Q09"] }])).toContain(
      "unknown-question Q01 distinct Q09",
    );
  });

  it("finds pairs only among open questions", () => {
    const shared = parseQuestions("questions.yaml", { questions: [SMS] });
    const answered = parseQuestions(INCIDENT_PATH, {
      questions: [{ ...SMS, status: "answered", answer: "No.", by: "owner", on: "2026-10-20" }],
    });
    expect(possibleDuplicates([shared, answered])).toEqual([]);
  });
});

describe("docs questions", () => {
  it("finds the question about a record, or with given words, with the pages that cite it", async () => {
    const deps = {
      sources: sources([{ ...SMS, ask: "Who approves a reassignment?", about: [] }]),
      root: "/ws",
    };
    expect((await listQuestions(deps, { about: RULE })).map((item) => item.ref)).toEqual([
      "shared/Q01",
    ]);
    const found = await listQuestions(deps, { search: "approves REASSIGNMENT" });
    expect(found).toMatchObject([
      { ref: "incident/Q01", citedBy: ["processes/incident/configure/assign.md"] },
    ]);
    expect(await listQuestions(deps, { process: "incident", status: "answered" })).toEqual([]);
    const withFeature = {
      sources: fakeSources(LIST, {
        questions: [{ path: "questions.yaml", questions: { questions: [SMS] } }],
        features: [
          {
            path: "processes/incident/features.yaml",
            features: {
              features: [
                {
                  id: "sms",
                  title: "SMS",
                  found: ["global"],
                  status: "question",
                  question: "shared/Q01",
                },
                { id: "chat", title: "Chat", found: ["global"], status: "todo" },
              ],
            },
          },
        ],
      }).sources,
      root: "/ws",
    };
    expect((await listQuestions(withFeature, { search: "sms" }))[0]?.citedBy).toEqual([
      "processes/incident/configure/assign.md",
      "processes/incident/features.yaml#sms",
    ]);
  });
});

describe("docs build: shared questions", () => {
  it("tracks shared questions first, across processes, with each page's process", async () => {
    let written: readonly { path: string; content: string | Uint8Array }[] = [];
    await buildSite({
      ...run,
      sources: sources([{ ...SMS, ask: "Who approves a reassignment?", about: [] }], [SMS], {
        ...SITE,
        employees: GUIDE,
      }),
      markdown: { html: (md) => `<md>${md}</md>` },
      output: {
        root: "/ws/site",
        replace: async (files) => {
          written = files;
        },
      },
      media: NO_MEDIA,
    });
    const tracker = String(written.find((item) => item.path === "it/open-questions.html")?.content);
    expect(tracker.indexOf("<h2>Across processes</h2>")).toBeLessThan(
      tracker.indexOf("<h2>Incident management</h2>"),
    );
    expect(tracker).toContain("<h3>For the platform owner (1)</h3>");
    expect(tracker).toContain('id="shared-Q01"');
    expect(tracker).toContain(">Incident management: Assignment configuration</a>");
  });
});
