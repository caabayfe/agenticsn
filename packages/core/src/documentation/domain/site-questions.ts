import { escapeHtml } from "./html";
import { openQuestionsOf } from "./open-questions";
import type { DocPage } from "./page";
import type { Process } from "./process";
import {
  findQuestion,
  type ProcessQuestions,
  type Question,
  questionCitationsOf,
} from "./questions";
import { OPEN_QUESTIONS } from "./site-layout";

// Questions on the site (ADR-0041): citations lead to the tracker, the IT guide's open-questions
// page, which exists only beside an employee guide.

export const KIND_TEXT: Readonly<Record<Question["kind"], string>> = {
  decide: "Decision",
  check: "Check on screen",
  hidden: "Value not in the mirror",
};

// What the site's question parts read: the questions, the processes and pages citing them, and
// whether the site has the tracker.
export interface QuestionSite {
  readonly questions: readonly ProcessQuestions[];
  readonly processes: readonly Process[];
  readonly pages: readonly DocPage[];
  readonly tracked: boolean;
}

export const questionAnchor = (process: string, id: string) => `${process}-${id}`;

export function questionHref(site: QuestionSite, prefix: string, process: string, id: string) {
  return !site.tracked ? null : `${prefix}${OPEN_QUESTIONS}#${questionAnchor(process, id)}`;
}

// Who answers, in words: a role's name, the process owner or the platform team.
export function whoText(process: Process | undefined, who: string): string {
  if (who === "owner") return "the process owner";
  if (who === "platform") return "the platform team";
  return process?.roles.find((role) => role.id === who)?.name ?? who;
}

// The open questions a page cites, as a section after its text.
export function pageQuestionsHtml(site: QuestionSite, page: DocPage, prefix: string): string {
  const items = questionCitationsOf(page.body).flatMap((ref) => {
    const found = findQuestion(site.questions, ref, page.process);
    if (found === null || found.question.status !== "open") return [];
    const { process, question } = found;
    const owner = site.processes.find((item) => item.id === process);
    const href = questionHref(site, prefix, process, question.id);
    const name = href === null ? ref : `<a href="${href}">${escapeHtml(ref)}</a>`;
    return [
      `<li><strong>${name}</strong> ${escapeHtml(question.ask)} <span class="mute">${escapeHtml(KIND_TEXT[question.kind])}, for ${escapeHtml(whoText(owner, question.who))}</span></li>`,
    ];
  });
  if (items.length === 0) return "";
  return `<h2 id="questions">Open questions <span class="label label-open-question">OPEN QUESTION</span></h2><ul class="questions">${items.join("")}</ul>`;
}

// Open questions of a process (or of all): its questions.yaml's open ones and the sections of
// pages not yet migrated.
export function openQuestionCount(site: QuestionSite, process?: string): number {
  const declared = site.questions.filter(
    (item) => process === undefined || item.process === process,
  );
  const structured = declared
    .flatMap((item) => item.questions)
    .filter((question) => question.status === "open").length;
  const sections = openQuestionsOf(
    site.pages.filter((page) => process === undefined || page.process === process),
  ).length;
  return structured + sections;
}
