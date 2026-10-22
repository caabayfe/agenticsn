import { anchorOf } from "./evidence";
import { type ProcessQuestions, type Question, questionRef } from "./questions";

// Two open questions that may ask the same thing (ADR-0041, item 8): about the same record from
// different files, or worded nearly alike.

export interface DuplicatePair {
  readonly path: string;
  readonly first: string;
  readonly second: string;
  readonly why: string;
}

// Wording at or above this share of common words counts as nearly the same.
export const SIMILAR_WORDING = 0.6;

const STOP = new Set(
  "the a an of to and or is are be in on for it its by with as that this should which what does do can when who from at not any there their than they how".split(
    " ",
  ),
);

export function wordsOf(text: string): ReadonlySet<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z_][a-z0-9_.]{2,}/g) ?? []).filter((word) => !STOP.has(word)),
  );
}

export function similarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const common = [...left].filter((word) => right.has(word)).length;
  const all = new Set([...left, ...right]).size;
  return all === 0 ? 0 : common / all;
}

interface Entry {
  readonly declared: ProcessQuestions;
  readonly question: Question;
  readonly key: string;
  readonly words: ReadonlySet<string>;
  readonly records: ReadonlySet<string>;
}

const keyOf = (process: string, id: string) => `${process}/${id}`;

function marked(entry: Entry, other: Entry): boolean {
  return entry.question.distinct.some((ref) => {
    const target = questionRef(ref, entry.declared.process);
    return keyOf(target.process, target.id) === other.key;
  });
}

function why(left: Entry, right: Entry): string | null {
  if (left.declared.path !== right.declared.path) {
    const shared = [...left.records].find((record) => right.records.has(record));
    if (shared !== undefined) return `both are about ${shared}`;
  }
  return similarity(left.words, right.words) >= SIMILAR_WORDING ? "nearly the same wording" : null;
}

export function possibleDuplicates(all: readonly ProcessQuestions[]): readonly DuplicatePair[] {
  const entries: Entry[] = all.flatMap((declared) =>
    declared.questions
      .filter((question) => question.status === "open")
      .map((question) => ({
        declared,
        question,
        key: keyOf(declared.process, question.id),
        words: wordsOf(question.ask),
        records: new Set(question.about.map((item) => anchorOf(item).split("#")[0] ?? "")),
      })),
  );
  const pairs: DuplicatePair[] = [];
  entries.forEach((left, index) => {
    for (const right of entries.slice(index + 1)) {
      if (marked(left, right) || marked(right, left)) continue;
      const reason = why(left, right);
      if (reason !== null) {
        pairs.push({ path: left.declared.path, first: left.key, second: right.key, why: reason });
      }
    }
  });
  return pairs;
}
