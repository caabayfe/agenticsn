import { escapeHtml } from "./html";
import { recordHtml } from "./instance-links";
import { openQuestionsOf } from "./open-questions";
import type { Process } from "./process";
import { citersOf } from "./question-checks";
import { type ProcessQuestions, type Question, questionRef } from "./questions";
import { type Built, bodyHtml, checked, guideCrumbs, link, questionSite } from "./site-context";
import { layout, OPEN_QUESTIONS, pageFile, prefixOf } from "./site-layout";
import { navFor } from "./site-nav";
import { KIND_TEXT, openQuestionCount, questionAnchor, whoText } from "./site-questions";

const prefix = prefixOf(OPEN_QUESTIONS);

function questionLinks(refs: readonly string[], own: string): string {
  return refs
    .map((ref) => {
      const target = questionRef(ref, own);
      return `<a href="#${questionAnchor(target.process, target.id)}">${escapeHtml(ref)}</a>`;
    })
    .join(", ");
}

// The questions that wait on this one, as cited from this process.
function waitingOn(b: Built, process: string, id: string): readonly string[] {
  return (b.input.questions ?? []).flatMap((declared) =>
    declared.questions
      .filter((other) =>
        other.after.some((ref) => {
          const target = questionRef(ref, declared.process);
          return target.process === process && target.id === id;
        }),
      )
      .map((other) =>
        declared.process === process ? other.id : `${declared.process}/${other.id}`,
      ),
  );
}

function answerHtml(question: Question): string {
  if (question.answer === undefined) return "";
  const who =
    question.by === undefined
      ? ""
      : ` <span class="mute">${escapeHtml(question.by)}, ${escapeHtml(question.on ?? "")}</span>`;
  const label = question.status === "dropped" ? "Dropped" : "Answer";
  return `<p><strong>${label}:</strong> ${escapeHtml(question.answer)}${who}</p>`;
}

function questionHtml(b: Built, process: Process, question: Question): string {
  const pages = citersOf(b.input, process.id, question.id).map((page) =>
    link(prefix, pageFile(page, page.section === "use" ? "user" : "operator"), page.title),
  );
  const waiting = waitingOn(b, process.id, question.id);
  const about = question.about.map((item) =>
    recordHtml(b.input.instanceUrl, item.table, item.sysId, `${item.table}/${item.sysId}`),
  );
  const facts = [
    pages.length === 0 ? "" : `On ${pages.join(", ")}`,
    question.after.length === 0 ? "" : `Waits on ${questionLinks(question.after, process.id)}`,
    waiting.length === 0 ? "" : `Holds back ${questionLinks(waiting, process.id)}`,
    about.length === 0 ? "" : `About ${about.join(", ")}`,
  ].filter((fact) => fact !== "");
  const kind = `<span class="label label-${question.kind}">${escapeHtml(KIND_TEXT[question.kind])}</span>`;
  return (
    `<div class="question" id="${questionAnchor(process.id, question.id)}">` +
    `<p><strong>${question.id}</strong> ${escapeHtml(question.ask)} ${kind}</p>${answerHtml(question)}` +
    `${facts.length === 0 ? "" : `<p class="mute">${facts.join(" · ")}</p>`}</div>`
  );
}

// A process's questions: open ones by who answers them, then the closed ones.
function declaredHtml(b: Built, process: Process, declared: ProcessQuestions): string {
  const open = declared.questions.filter((question) => question.status === "open");
  const closed = declared.questions.filter((question) => question.status !== "open");
  const askees = [...new Set(open.map((question) => question.who))];
  const groups = askees.map((who) => {
    const mine = open.filter((question) => question.who === who);
    const items = mine.map((question) => questionHtml(b, process, question)).join("");
    return `<h3>For ${escapeHtml(whoText(process, who))} (${mine.length})</h3>${items}`;
  });
  const done =
    closed.length === 0
      ? ""
      : `<details class="answered"><summary>Answered or dropped (${closed.length})</summary>${closed.map((question) => questionHtml(b, process, question)).join("")}</details>`;
  return `<p class="mute">${open.length} open, ${closed.length} answered or dropped</p>${groups.join("")}${done}`;
}

// Pages not yet migrated: their open-question sections, as written.
function sectionsHtml(b: Built, process: Process): string {
  const mine = openQuestionsOf(b.input.pages).filter((item) => item.page.process === process.id);
  return mine
    .map((question) => {
      const view = question.page.section === "use" ? "user" : "operator";
      const body = bodyHtml(
        b,
        { ...question.page, body: question.body },
        OPEN_QUESTIONS,
        undefined,
        true,
      );
      return `<h3>${escapeHtml(question.heading)}</h3><p class="mute">On ${link(prefix, pageFile(question.page, view), question.page.title)}</p>${body}`;
    })
    .join("");
}

// Every open question of the documentation on one page of the IT guide, by process: what the
// platform team should answer, and who should answer it (ADR-0041). Employee pages leave them
// out (ADR-0037).
export function openQuestionsHtml(b: Built, processes: readonly Process[]): string {
  const parts = processes.flatMap((process) => {
    const declared = (b.input.questions ?? []).find((item) => item.process === process.id);
    const body =
      (declared === undefined ? "" : declaredHtml(b, process, declared)) + sectionsHtml(b, process);
    return body === "" ? [] : [`<h2>${escapeHtml(process.title)}</h2>${body}`];
  });
  const main = `<h1>Open questions</h1>
<p class="lead">What the documentation couldn't establish from the instance: decisions for the process owner, screens to check, and values the mirror doesn't hold.</p>
<div class="banner"><span>${openQuestionCount(questionSite(b))} open questions</span><span>${checked(b)}</span></div>
${parts.join("\n")}`;
  return layout(
    b.input.config,
    "Open questions",
    OPEN_QUESTIONS,
    guideCrumbs(b, "platform"),
    main,
    navFor(b, OPEN_QUESTIONS),
  );
}
