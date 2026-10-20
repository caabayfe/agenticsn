import { openQuestionsOf } from "./open-questions";
import type { DocPage } from "./page";
import {
  findQuestion,
  type ProcessQuestions,
  QUESTION_ASKEES,
  type Question,
  questionCitationsOf,
  questionRef,
} from "./questions";
import { type DocSet, type DocsProblem, docsProblem } from "./structure";

// What `docs check` finds in the questions and their citations, before the mirror is read
// (ADR-0041).

const key = (process: string, id: string) => `${process}/${id}`;

// Every question cited by a page or a feature, as <process>/<id>.
function citedKeys(docs: DocSet): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const page of docs.pages) {
    for (const ref of questionCitationsOf(page.body)) {
      const target = questionRef(ref, page.process);
      keys.add(key(target.process, target.id));
    }
  }
  for (const declared of docs.features) {
    for (const feature of declared.features) {
      if (feature.question === undefined) continue;
      const target = questionRef(feature.question, declared.process);
      keys.add(key(target.process, target.id));
    }
  }
  return keys;
}

function pageQuestionProblems(docs: DocSet, page: DocPage): readonly DocsProblem[] {
  const problems: DocsProblem[] = [];
  for (const ref of questionCitationsOf(page.body)) {
    const found = findQuestion(docs.questions, ref, page.process);
    if (found === null) problems.push(docsProblem("unknown-question", page.path, ref));
    else if (found.question.status !== "open") {
      problems.push(
        docsProblem("answered-not-applied", page.path, `${ref} is ${found.question.status}`),
      );
    }
  }
  for (const item of page.evidence) {
    if (item.kind !== "answered") continue;
    const found = findQuestion(docs.questions, item.question, page.process);
    if (found === null) {
      problems.push(docsProblem("unknown-question", page.path, `${item.id} ${item.question}`));
    } else if (found.question.status !== "answered") {
      problems.push(
        docsProblem("bad-question", page.path, `${item.id}: ${item.question} is not answered`),
      );
    }
  }
  const declared = docs.questions.some((item) => item.process === page.process);
  if (declared && openQuestionsOf([page]).length > 0) {
    problems.push(docsProblem("unstructured-question", page.path, "cite questions.yaml instead"));
  }
  return problems;
}

function featureQuestionProblems(docs: DocSet): readonly DocsProblem[] {
  return docs.features.flatMap((declared) =>
    declared.features.flatMap((feature) => {
      if (feature.question === undefined) return [];
      const found = findQuestion(docs.questions, feature.question, declared.process);
      if (found === null) {
        return [
          docsProblem("unknown-question", declared.path, `${feature.id}: ${feature.question}`),
        ];
      }
      return found.question.status !== "open" && feature.status === "question"
        ? [
            docsProblem(
              "answered-not-applied",
              declared.path,
              `${feature.id}: ${feature.question} is ${found.question.status}`,
            ),
          ]
        : [];
    }),
  );
}

// A question that waits, through `after`, on itself.
function inCycle(docs: DocSet, start: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop() ?? "";
    const [process = "", id = ""] = current.split("/");
    const question = findQuestion(docs.questions, id, process)?.question;
    for (const ref of question?.after ?? []) {
      const target = questionRef(ref, process);
      const next = key(target.process, target.id);
      if (next === start) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

function oneQuestionProblems(
  docs: DocSet,
  declared: ProcessQuestions,
  question: Question,
  cited: ReadonlySet<string>,
): readonly DocsProblem[] {
  const at = declared.path;
  const process = docs.processes.find((item) => item.id === declared.process);
  const roles = new Set<string>([...QUESTION_ASKEES, ...(process?.roles ?? []).map((r) => r.id)]);
  const problems: DocsProblem[] = [];
  if (!roles.has(question.who)) {
    problems.push(
      docsProblem("bad-question", at, `${question.id}: who ${question.who} is no role`),
    );
  }
  for (const ref of question.after) {
    if (findQuestion(docs.questions, ref, declared.process) === null) {
      problems.push(docsProblem("unknown-question", at, `${question.id} after ${ref}`));
    }
  }
  if (inCycle(docs, key(declared.process, question.id))) {
    problems.push(docsProblem("bad-question", at, `${question.id} waits on itself`));
  }
  if (question.status === "open" && !cited.has(key(declared.process, question.id))) {
    problems.push(
      docsProblem("unasked-question", at, `${question.id}: no page or feature cites it`),
    );
  }
  return problems;
}

export function questionProblems(docs: DocSet): readonly DocsProblem[] {
  const cited = citedKeys(docs);
  const processIds = new Set(docs.processes.map((process) => process.id));
  return [
    ...docs.pages.flatMap((page) => pageQuestionProblems(docs, page)),
    ...featureQuestionProblems(docs),
    ...docs.questions.flatMap((declared) => [
      ...(processIds.has(declared.process)
        ? []
        : [docsProblem("unknown-process", declared.path, declared.process)]),
      ...declared.questions.flatMap((question) =>
        oneQuestionProblems(docs, declared, question, cited),
      ),
    ]),
  ];
}

// The pages and features that cite a question, for the tracker.
export function citersOf(
  docs: Pick<DocSet, "pages">,
  process: string,
  id: string,
): readonly DocPage[] {
  return docs.pages.filter((page) =>
    questionCitationsOf(page.body).some((ref) => {
      const target = questionRef(ref, page.process);
      return target.process === process && target.id === id;
    }),
  );
}
