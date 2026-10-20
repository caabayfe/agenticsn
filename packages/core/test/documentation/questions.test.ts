import { describe, expect, it } from "bun:test";
import {
  checkDocs,
  DocumentationSourceError,
  type PageSource,
  parseQuestions,
  pinDocs,
} from "@snagentic/core";
import {
  ALL,
  fakeMirror,
  fakeSources,
  pages,
  RULE,
  run,
  SCRIPT,
  sha256Hex,
  withPage,
} from "../support/docs-fixtures";

const PATH = "processes/incident/questions.yaml";

const OPEN = {
  id: "Q01",
  ask: "Should the rule also set the group on change?",
  kind: "decide",
  who: "owner",
  about: [{ record: `sys_script/${RULE}`, field: "script", hash: sha256Hex(SCRIPT) }],
};
const ANSWERED = {
  id: "Q02",
  ask: "Is the Unassigned list the one agents use?",
  kind: "check",
  who: "agent",
  status: "answered",
  answer: "Yes, every shift starts there.",
  by: "service desk lead",
  on: "2026-10-20",
};

// The assignment page cites Q01; Q02 is answered.
const CITING = ALL.map((page) =>
  page.path === pages.configureAssign.path
    ? withPage(page, { body: "The rule sets the group. [E01] [Q01]" })
    : page,
);

async function check(
  list: readonly PageSource[],
  questions: unknown[],
  mirror = fakeMirror(),
  features?: { path: string; features: unknown }[],
) {
  const { sources } = fakeSources(list, {
    questions: [{ path: PATH, questions: { questions } }],
    ...(features === undefined ? {} : { features }),
  });
  return checkDocs({ ...run, sources, mirror: () => mirror });
}

const kinds = (result: Awaited<ReturnType<typeof check>>) =>
  result.problems.map((problem) => `${problem.kind} ${problem.detail}`);

describe("questions.yaml", () => {
  it("reads a question with its kind, who answers, what it is about and what it waits on", () => {
    const parsed = parseQuestions(PATH, { questions: [{ ...OPEN, after: ["on-call/Q03"] }] });
    expect(parsed.process).toBe("incident");
    expect(parsed.questions[0]).toMatchObject({
      id: "Q01",
      kind: "decide",
      who: "owner",
      status: "open",
      after: ["on-call/Q03"],
    });
    expect(parsed.questions[0]?.about[0]).toMatchObject({ table: "sys_script", field: "script" });
  });

  it("refuses an answer without who gave it and when", () => {
    expect(() => parseQuestions(PATH, { questions: [{ ...ANSWERED, by: undefined }] })).toThrow(
      DocumentationSourceError,
    );
  });

  it("refuses a kind it doesn't know and an id that is not Q and digits", () => {
    expect(() => parseQuestions(PATH, { questions: [{ ...OPEN, kind: "maybe" }] })).toThrow(
      DocumentationSourceError,
    );
    expect(() => parseQuestions(PATH, { questions: [{ ...OPEN, id: "q1" }] })).toThrow(
      DocumentationSourceError,
    );
  });
});

describe("docs check: questions", () => {
  it("accepts a page that cites an open question", async () => {
    const result = await check(CITING, [OPEN]);
    expect(kinds(result).filter((kind) => kind.includes("question"))).toEqual([]);
  });

  it("fails a page that cites a question nobody declared", async () => {
    const result = await check(CITING, [ANSWERED]);
    expect(kinds(result)).toContain("unknown-question Q01");
    expect(result.ok).toBe(false);
  });

  it("warns when a page still cites a question that has been answered", async () => {
    const list = CITING.map((page) =>
      page.path === pages.configureAssign.path
        ? withPage(page, { body: "The rule sets the group. [E01] [Q02]" })
        : page,
    );
    const result = await check(list, [OPEN, ANSWERED]);
    expect(kinds(result)).toContain("answered-not-applied Q02 is answered");
    expect(kinds(result)).toContain("unasked-question Q01: no page or feature cites it");
  });

  it("warns that a question may be moot when what it is about changed in the mirror", async () => {
    const changed = fakeMirror({
      [`sys_script/${RULE}`]: { hash: "x", fields: { script: "something else" } },
    });
    const result = await check(CITING, [OPEN], changed);
    expect(kinds(result)).toContain(`question-may-be-moot Q01#0 sys_script/${RULE}#script changed`);
  });

  it("takes an answer as evidence, and refuses an answer to a question still open", async () => {
    const answered = (question: string) =>
      ALL.map((page) =>
        page.path === pages.configureAssign.path
          ? withPage(page, {
              body: "The rule sets the group. [E01] Agents start on the list. [E02] [Q01]",
              frontMatter: {
                title: "Assignment configuration",
                evidence: {
                  E01: { record: `sys_script/${RULE}`, field: "script", how: "read", result: "r" },
                  E02: { answered: question, how: "asked the lead", result: "they do" },
                },
              },
            })
          : page,
      );
    const fine = await check(answered("Q02"), [OPEN, ANSWERED]);
    expect(fine.evidence.find((item) => item.id === "E02")).toMatchObject({
      status: "answered",
      anchor: "answer to Q02",
    });
    const open = await check(answered("Q01"), [OPEN, ANSWERED]);
    expect(kinds(open)).toContain("bad-question E02: Q01 is not answered");
  });

  it("refuses a who that is no role, and a question that waits on itself", async () => {
    const result = await check(CITING, [
      { ...OPEN, who: "nobody", after: ["Q03"] },
      { ...OPEN, id: "Q03", after: ["Q01"] },
    ]);
    expect(kinds(result)).toContain("bad-question Q01: who nobody is no role");
    expect(kinds(result)).toContain("bad-question Q01 waits on itself");
  });

  it("asks a migrated process to cite questions instead of writing open-question sections", async () => {
    const list = CITING.map((page) =>
      page.path === pages.assign.path
        ? withPage(page, {
            body: `${page.body}\n## Open questions {label=OPEN-QUESTION}\n\n1. Why?\n`,
          })
        : page,
    );
    const result = await check(list, [OPEN]);
    expect(kinds(result)).toContain("unstructured-question cite questions.yaml instead");
  });

  it("lets a feature wait on a question, and says when the question was answered", async () => {
    const features = [
      {
        path: "processes/incident/features.yaml",
        features: {
          features: [
            { id: "chat", title: "Chat", found: ["global"], status: "question", question: "Q02" },
          ],
        },
      },
    ];
    const result = await check(CITING, [OPEN, ANSWERED], fakeMirror(), features);
    expect(kinds(result)).toContain("answered-not-applied chat: Q02 is answered");
  });
});

describe("docs pin: questions", () => {
  it("pins what an open question is about, so a later change is noticed", async () => {
    const { sources, pinned } = fakeSources(CITING, {
      questions: [
        {
          path: PATH,
          questions: { questions: [{ ...OPEN, about: [{ record: `sys_script/${RULE}` }] }] },
        },
      ],
    });
    await pinDocs({ ...run, sources }, {});
    expect(pinned.get(PATH)).toEqual(new Map([["Q01#0", "aaa"]]));
  });
});
