import { employeePage, guideEntries } from "./employee-guide";
import { escapeHtml } from "./html";
import type { DocPage } from "./page";
import type { Process } from "./process";
import { type Built, bodyHtml, guideCrumbs, staleOf } from "./site-context";
import { type Crumb, layout, pageFile, prefixOf, sectionHome, staleNotice } from "./site-layout";
import { navFor } from "./site-nav";

// An employee's page (ADR-0037): the steps and the explanation, without the apparatus that is for
// IT (evidence tables, citations, review labels, open questions, step numbers by process). The
// previous and next pages follow the employee guide's order.

const lastChecked = (b: Built) =>
  `<div class="banner"><span>Last checked ${escapeHtml(b.input.builtAt)}</span></div>`;

function crumbs(b: Built, process: Process): readonly Crumb[] {
  return [...guideCrumbs(b, "user"), { href: sectionHome(process.id, "use"), text: process.title }];
}

// The page before and after `file` in the employee guide's order, when the page is in it.
function nearInGuide(b: Built, file: string) {
  const guide = b.input.config.employees;
  const files = (guide === undefined ? [] : guideEntries(guide)).flatMap((target) => {
    const page = employeePage(target, b.input.pages);
    return page === undefined ? [] : [{ href: pageFile(page, "user"), text: page.title }];
  });
  const index = files.findIndex((item) => item.href === file);
  return index < 0
    ? { previous: undefined, next: undefined }
    : { previous: files[index - 1], next: files[index + 1] };
}

function pager(prefix: string, near: ReturnType<typeof nearInGuide>): string {
  const side = (item: { href: string; text: string } | undefined, rel: "prev" | "next") =>
    item === undefined
      ? "<span></span>"
      : `<a rel="${rel}" href="${prefix}${item.href}">${rel === "prev" ? "← " : ""}${escapeHtml(item.text)}${rel === "next" ? " →" : ""}</a>`;
  return `<nav class="pager" aria-label="Previous and next">${side(near.previous, "prev")}${side(near.next, "next")}</nav>`;
}

export function employeePageHtml(b: Built, process: Process, page: DocPage): string {
  const view = page.section === "understand" ? "user" : undefined;
  const file = pageFile(page, "user");
  const main = `<h1>${escapeHtml(page.title)}</h1>
${lastChecked(b)}
${staleNotice(staleOf(b, page), "guide")}
${bodyHtml(b, page, file, view, true)}
${pager(prefixOf(file), nearInGuide(b, file))}`;
  return layout(b.input.config, page.title, file, crumbs(b, process), main, navFor(b, file));
}
