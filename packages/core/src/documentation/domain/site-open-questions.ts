import { escapeHtml } from "./html";
import { openQuestionsOf } from "./open-questions";
import type { Process } from "./process";
import { type Built, bodyHtml, checked, guideCrumbs, link } from "./site-context";
import { layout, OPEN_QUESTIONS, pageFile, prefixOf } from "./site-layout";
import { navFor } from "./site-nav";

// Every open question of the documentation on one page of the IT guide, by process: what the
// platform team should answer. Employee pages leave them out (ADR-0037).
export function openQuestionsHtml(b: Built, processes: readonly Process[]): string {
  const prefix = prefixOf(OPEN_QUESTIONS);
  const questions = openQuestionsOf(b.input.pages);
  const parts = processes.flatMap((process) => {
    const mine = questions.filter((question) => question.page.process === process.id);
    if (mine.length === 0) return [];
    const items = mine.map((question) => {
      const view = question.page.section === "use" ? "user" : "operator";
      const body = bodyHtml(
        b,
        { ...question.page, body: question.body },
        OPEN_QUESTIONS,
        undefined,
        true,
      );
      return `<h3>${escapeHtml(question.heading)}</h3><p class="mute">On ${link(prefix, pageFile(question.page, view), question.page.title)}</p>${body}`;
    });
    return [`<h2>${escapeHtml(process.title)}</h2>${items.join("")}`];
  });
  const main = `<h1>Open questions</h1>
<p class="lead">What the documentation couldn't establish from the instance: each needs an answer from the platform team, or a check on screen.</p>
<div class="banner"><span>${questions.length} open questions</span><span>${checked(b)}</span></div>
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
