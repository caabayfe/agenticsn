import { anchorOf } from "../domain/evidence";
import { citersOf } from "../domain/question-checks";
import { type QuestionKind, type QuestionStatus, questionRef } from "../domain/questions";
import type { DocumentationSources } from "../ports";
import { type Documentation, loadDocumentation } from "./load-documentation";

export interface QuestionsQuery {
  // A record, <table>/<sys_id>, or a sys_id alone: questions about it.
  readonly about?: string;
  // Words that must all appear in the question or its answer.
  readonly search?: string;
  // A process id, or "shared".
  readonly process?: string;
  // Open by default; "all" lists answered and dropped ones too.
  readonly status?: QuestionStatus | "all";
}

export interface ListedQuestion {
  // As another process cites it: <process>/Q01.
  readonly ref: string;
  readonly ask: string;
  readonly kind: QuestionKind;
  readonly who: string;
  readonly status: QuestionStatus;
  readonly answer?: string;
  readonly about: readonly string[];
  // The pages that cite it, and the features (<features.yaml path>#<feature id>).
  readonly citedBy: readonly string[];
}

function featureCiters(docs: Documentation, process: string, id: string): readonly string[] {
  return docs.features.flatMap((declared) =>
    declared.features.flatMap((feature) => {
      if (feature.question === undefined) return [];
      const target = questionRef(feature.question, declared.process);
      return target.process === process && target.id === id
        ? [`${declared.path}#${feature.id}`]
        : [];
    }),
  );
}

const matches = (text: string, words: readonly string[]) =>
  words.every((word) => text.toLowerCase().includes(word));

// `docs questions` (ADR-0041, item 9): the questions already asked, so an author cites one
// instead of asking it again.
export async function listQuestions(
  deps: { readonly sources: DocumentationSources; readonly root: string },
  query: QuestionsQuery,
): Promise<readonly ListedQuestion[]> {
  const docs = await loadDocumentation(deps.sources, deps.root);
  const words = (query.search ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const status = query.status ?? "open";
  return docs.questions
    .filter((declared) => query.process === undefined || declared.process === query.process)
    .flatMap((declared) =>
      declared.questions.flatMap((question) => {
        const about = question.about.map((item) => anchorOf(item));
        const wanted =
          (status === "all" || question.status === status) &&
          matches(`${question.ask} ${question.answer ?? ""}`, words) &&
          (query.about === undefined || about.some((anchor) => anchor.includes(query.about ?? "")));
        if (!wanted) return [];
        return [
          {
            ref: `${declared.process}/${question.id}`,
            ask: question.ask,
            kind: question.kind,
            who: question.who,
            status: question.status,
            ...(question.answer === undefined ? {} : { answer: question.answer }),
            about,
            citedBy: [
              ...citersOf(docs, declared.process, question.id).map((page) => page.path),
              ...featureCiters(docs, declared.process, question.id),
            ],
          },
        ];
      }),
    );
}
