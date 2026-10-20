import { DocumentationSourceError } from "./errors";
import { parseAnchor, type RecordEvidence } from "./evidence";
import { fieldsOf, textOf } from "./fields";
import { proseOf } from "./page";

// processes/<process>/questions.yaml (ADR-0041): what the documentation couldn't establish, each
// asked once, of one role, with its answer when it has one.

export const QUESTION_KINDS = ["decide", "check", "hidden"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QUESTION_STATUSES = ["open", "answered", "dropped"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
// Who answers, besides a role of the process.
export const QUESTION_ASKEES = ["owner", "platform"] as const;

export interface Question {
  readonly id: string;
  readonly ask: string;
  readonly kind: QuestionKind;
  readonly who: string;
  // The records it concerns, pinned like evidence: when one changes, the instance may have
  // answered it.
  readonly about: readonly RecordEvidence[];
  // Questions it waits on, as cited: Q01, or on-call/Q01.
  readonly after: readonly string[];
  readonly status: QuestionStatus;
  // Answered: what, by whom, when (YYYY-MM-DD). Dropped: why, in `answer`.
  readonly answer?: string;
  readonly by?: string;
  readonly on?: string;
}

export interface ProcessQuestions {
  // processes/<process>/questions.yaml
  readonly path: string;
  readonly process: string;
  readonly questions: readonly Question[];
}

const ID = /^Q\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A citation in a page: [Q03] or [on-call/Q03].
export const QUESTION_CITE = /\[((?:[a-z][a-z0-9-]*\/)?Q\d+)\]/g;
export const QUESTION_REF = /^(?:[a-z][a-z0-9-]*\/)?Q\d+$/;

const oneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T =>
  (list as readonly (string | undefined)[]).includes(value);

const strings = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.flatMap((item) => textOf(item) ?? []) : [];

const dateOf = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : textOf(value);

function fail(path: string, id: string, message: string): never {
  throw new DocumentationSourceError(path, `question ${id}: ${message}`);
}

function closing(
  path: string,
  id: string,
  status: QuestionStatus,
  fields: Record<string, unknown>,
) {
  const answer = textOf(fields["answer"]);
  const by = textOf(fields["by"]);
  const on = dateOf(fields["on"]);
  if (status === "answered" && (answer === undefined || by === undefined || on === undefined)) {
    fail(path, id, "answered needs answer, by and on (YYYY-MM-DD)");
  }
  if (status === "dropped" && answer === undefined) {
    fail(path, id, "dropped needs answer: why it no longer matters");
  }
  if (on !== undefined && !DATE.test(on)) fail(path, id, "on must be YYYY-MM-DD");
  return {
    ...(answer === undefined ? {} : { answer }),
    ...(by === undefined ? {} : { by }),
    ...(on === undefined ? {} : { on }),
  };
}

function questionOf(path: string, raw: unknown): Question {
  const fields = { ...fieldsOf(raw) };
  const id = textOf(fields["id"]) ?? "";
  if (!ID.test(id)) {
    throw new DocumentationSourceError(path, `each question needs an id Q01, Q02…, not "${id}"`);
  }
  const ask = textOf(fields["ask"]) ?? fail(path, id, "needs ask: the question");
  const kind = textOf(fields["kind"]);
  if (!oneOf(QUESTION_KINDS, kind)) fail(path, id, `kind must be ${QUESTION_KINDS.join(", ")}`);
  const who = textOf(fields["who"]) ?? fail(path, id, "needs who: the role that answers");
  const status = textOf(fields["status"]) ?? "open";
  if (!oneOf(QUESTION_STATUSES, status)) {
    fail(path, id, `status must be ${QUESTION_STATUSES.join(", ")}`);
  }
  const about = Array.isArray(fields["about"]) ? fields["about"] : [];
  const after = strings(fields["after"]);
  const wrong = after.find((ref) => !QUESTION_REF.test(ref));
  if (wrong !== undefined) fail(path, id, `after names ${wrong}, not a question`);
  return {
    id,
    ask,
    kind,
    who,
    about: about.map((item, index) => parseAnchor(path, `${id}#${index}`, item)),
    after,
    status,
    ...closing(path, id, status, fields),
  };
}

// `path` is processes/<id>/questions.yaml.
export function parseQuestions(path: string, raw: unknown): ProcessQuestions {
  const items = fieldsOf(raw)["questions"];
  const questions = Array.isArray(items) ? items.map((item) => questionOf(path, item)) : [];
  const ids = questions.map((question) => question.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) {
    throw new DocumentationSourceError(path, `question ${twice} is listed twice`);
  }
  return { path, process: path.split("/")[1] ?? "", questions };
}

// The question ids a page cites, as written.
export function questionCitationsOf(body: string): readonly string[] {
  const found = [...proseOf(body).matchAll(QUESTION_CITE)].map((match) => match[1] ?? "");
  return [...new Set(found)];
}

export interface QuestionRef {
  readonly process: string;
  readonly id: string;
}

// Q03 is the citing process's own; on-call/Q03 is on-call's.
export function questionRef(ref: string, own: string): QuestionRef {
  const [first = "", second] = ref.split("/");
  return second === undefined ? { process: own, id: first } : { process: first, id: second };
}

export function findQuestion(
  all: readonly ProcessQuestions[],
  ref: string,
  own: string,
): { readonly process: string; readonly question: Question } | null {
  const target = questionRef(ref, own);
  const question = all
    .find((declared) => declared.process === target.process)
    ?.questions.find((item) => item.id === target.id);
  return question === undefined ? null : { process: target.process, question };
}
