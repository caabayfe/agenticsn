import { employeePage } from "./employee-guide";
import { escapeHtml } from "./html";
import type { DocPage } from "./page";
import type { Process } from "./process";
import type { EmployeeGuide } from "./site-config";
import { type Built, checked, link, understandPages } from "./site-context";
import { EMPLOYEES_HOME, layout, pageFile, prefixOf } from "./site-layout";
import { navFor } from "./site-nav";

const IT_DOOR =
  "Operators and the platform team: each process step by step, and how it is configured";

function summaryOf(b: Built, page: DocPage): string {
  const process = b.input.processes.find((item) => item.id === page.process);
  return process?.capabilities.find((item) => item.id === page.topic)?.summary ?? "";
}

function entries(b: Built, targets: readonly string[], prefix: string): string {
  const items = targets.flatMap((target) => {
    const page = employeePage(target, b.input.pages);
    if (page === undefined) {
      return [];
    }
    const summary = summaryOf(b, page);
    return [
      `<li>${link(prefix, pageFile(page, "user"), page.title)}${summary === "" ? "" : `<br><span class="mute">${escapeHtml(summary)}</span>`}</li>`,
    ];
  });
  return `<ul class="pages">${items.join("")}</ul>`;
}

function howItWorks(b: Built, processes: readonly Process[], prefix: string): string {
  const parts = processes.flatMap((process) => {
    const topics = understandPages(b, process).map(
      (page) => `<li>${link(prefix, pageFile(page, "user"), page.title)}</li>`,
    );
    return topics.length === 0
      ? []
      : [`<h3>${escapeHtml(process.title)}</h3><ul class="pages">${topics.join("")}</ul>`];
  });
  return parts.length === 0 ? "" : `<h2>How it works</h2>${parts.join("")}`;
}

// The employee guide's home: where to start, then what employees want to do, then how each
// process works in their view.
export function employeesHomeHtml(
  b: Built,
  guide: EmployeeGuide,
  processes: readonly Process[],
): string {
  const prefix = prefixOf(EMPLOYEES_HOME);
  const tasks = guide.tasks.map(
    (task) =>
      `<h2>${escapeHtml(task.title)}</h2>${task.summary === "" ? "" : `<p>${escapeHtml(task.summary)}</p>`}${entries(b, task.pages, prefix)}`,
  );
  const main = `<h1>${escapeHtml(guide.title)}</h1>
${guide.intro === "" ? "" : `<p class="lead">${escapeHtml(guide.intro)}</p>`}
<div class="banner"><span>${checked(b)}</span></div>
${guide.start.length === 0 ? "" : `<h2>Start here</h2>${entries(b, guide.start, prefix)}`}
${tasks.join("\n")}
${howItWorks(b, processes, prefix)}`;
  return layout(b.input.config, guide.title, EMPLOYEES_HOME, [], main, navFor(b, EMPLOYEES_HOME));
}
