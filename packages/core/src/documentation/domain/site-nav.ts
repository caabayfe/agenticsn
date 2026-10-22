import { employeePage, explained } from "./employee-guide";
import { escapeHtml } from "./html";
import { iconSvg } from "./icons";
import type { Process } from "./process";
import {
  type Built,
  capabilitiesFor,
  configurePages,
  questionSite,
  understandPages,
} from "./site-context";
import {
  EMPLOYEES_HOME,
  IT_HOME,
  OPEN_QUESTIONS,
  pageFile,
  prefixOf,
  sectionHome,
} from "./site-layout";
import { openQuestionCount } from "./site-questions";
import { whatsNewOf } from "./site-releases";

// Which menu a page shows: the site map has none; with an employee guide, its pages (Use pages,
// the employees' view of Understand pages) show the employee guide; everything else the IT guide.
export type Guide = "map" | "employee" | "it";

export function guideOf(b: Built, file: string): Guide {
  if (file === "index.html") {
    return "map";
  }
  if (b.input.config.employees === undefined) {
    return "it";
  }
  return file.startsWith("employees/") || /^processes\/[^/]+\/use\//.test(file) ? "employee" : "it";
}

interface Link {
  readonly href: string;
  readonly text: string;
}

function linkHtml(prefix: string, current: string, link: Link): string {
  const mark = link.href === current ? ' aria-current="page"' : "";
  return `<li><a${mark} href="${prefix}${link.href}">${escapeHtml(link.text)}</a></li>`;
}

function group(
  prefix: string,
  current: string,
  title: string,
  icon: string | undefined,
  links: readonly Link[],
) {
  return links.length === 0
    ? ""
    : `<div class="grp"><div class="grp-h">${iconSvg(icon)}<span>${escapeHtml(title)}</span></div>` +
        `<ul>${links.map((item) => linkHtml(prefix, current, item)).join("")}</ul></div>`;
}

function folder(prefix: string, current: string, process: Process, links: readonly Link[]) {
  const open = current.startsWith(`processes/${process.id}/`) ? " open" : "";
  return links.length === 0
    ? ""
    : `<details class="proc"${open}><summary>${iconSvg(process.icon)}<span>${escapeHtml(process.title)}</span></summary>` +
        `<ul>${links.map((item) => linkHtml(prefix, current, item)).join("")}</ul></details>`;
}

const understandLinks = (b: Built, process: Process, view: "user" | "operator") =>
  understandPages(b, process).map((page) => ({ href: pageFile(page, view), text: page.title }));

function capabilityLinks(b: Built, process: Process, view: "user" | "operator"): readonly Link[] {
  const section = view === "user" ? "use" : "operate";
  return capabilitiesFor(process, view).flatMap((capability) => {
    const page = b.page(process.id, section, capability.id);
    return page === undefined ? [] : [{ href: pageFile(page), text: page.title }];
  });
}

const guideLinks = (b: Built, targets: readonly string[]): readonly Link[] =>
  targets.flatMap((target) => {
    const page = employeePage(target, b.input.pages);
    return page === undefined ? [] : [{ href: pageFile(page, "user"), text: page.title }];
  });

const whatsNew = (b: Built, page: "employees" | "it"): readonly Link[] => {
  const file = whatsNewOf(b, page);
  return file === null ? [] : [{ href: file, text: "What's new" }];
};

const search = (guide: "employee" | "it", label: string) =>
  `<input class="search" type="search" placeholder="Search" data-guide="${guide}" aria-label="Search the ${escapeHtml(label)}">` +
  '<p class="count" role="status" aria-live="polite"></p><ol class="results" hidden></ol>';

function employeeSide(b: Built, processes: readonly Process[], prefix: string, current: string) {
  const guide = b.input.config.employees;
  if (guide === undefined) {
    return "";
  }
  const tasks = guide.tasks.map((task) =>
    group(prefix, current, task.title, task.icon, guideLinks(b, task.pages)),
  );
  const how = explained(guide, processes).map((process) =>
    folder(prefix, current, process, understandLinks(b, process, "user")),
  );
  return `<nav class="side" aria-label="${escapeHtml(guide.title)}"><div class="side-h">${escapeHtml(guide.title)}</div>
${search("employee", guide.title)}<div class="groups">${group(prefix, current, "Start here", "home", [...guideLinks(b, guide.start), ...whatsNew(b, "employees")])}${tasks.join("")}
${how.join("") === "" ? "" : `<div class="grp-h sep">${iconSvg("book")}<span>How it works</span></div>${how.join("")}`}</div></nav>`;
}

function itSide(b: Built, processes: readonly Process[], prefix: string, current: string) {
  const single = b.input.config.employees === undefined;
  const folders = processes.map((process) => {
    const guides = [
      ...(single ? capabilityLinks(b, process, "user") : []),
      ...capabilityLinks(b, process, "operator"),
    ];
    const configured = configurePages(b, process).length > 0;
    // Beside an employee guide, a process with nothing for IT (such as getting-help) stays out.
    return !single && guides.length === 0 && !configured
      ? ""
      : folder(prefix, current, process, [
          ...understandLinks(b, process, "operator"),
          ...guides,
          ...(configured
            ? [{ href: sectionHome(process.id, "configure"), text: "How it is configured" }]
            : []),
        ]);
  });
  const questions = openQuestionCount(questionSite(b));
  const open =
    single || questions === 0
      ? ""
      : group(prefix, current, "For the platform team", "alert", [
          { href: OPEN_QUESTIONS, text: `Open questions (${questions})` },
        ]);
  const title = single ? b.input.config.title : "IT guide";
  const updates = group(prefix, current, "Updates", "refresh", whatsNew(b, "it"));
  return `<nav class="side" aria-label="${escapeHtml(title)}"><div class="side-h">${escapeHtml(title)}</div>
${search("it", title)}<div class="groups">${updates}${folders.join("")}${open}</div></nav>`;
}

function rail(b: Built, prefix: string, guide: Guide, current: string): string {
  const items: readonly (Link & { readonly icon: string; readonly guide: Guide })[] = [
    { href: "index.html", text: "Site map", icon: "home", guide: "map" },
    ...(b.input.config.employees === undefined
      ? []
      : [
          { href: EMPLOYEES_HOME, text: "Employees", icon: "user", guide: "employee" as const },
          { href: IT_HOME, text: "IT", icon: "wrench", guide: "it" as const },
        ]),
  ];
  const links = items.map(
    (item) =>
      `<a${item.guide === guide ? ' class="on"' : ""}${item.href === current ? ' aria-current="page"' : ""} href="${prefix}${item.href}">${iconSvg(item.icon)}<span>${escapeHtml(item.text)}</span></a>`,
  );
  return `<nav class="rail" aria-label="Guides">${links.join("")}</nav>`;
}

// The menu beside a page: the rail, and the sidebar of the page's guide.
export function navFor(b: Built, file: string): string {
  const processes = [...b.input.processes].sort(
    (left, right) => left.order - right.order || left.title.localeCompare(right.title),
  );
  const prefix = prefixOf(file);
  const guide = guideOf(b, file);
  const side =
    guide === "employee"
      ? employeeSide(b, processes, prefix, file)
      : guide === "it"
        ? itSide(b, processes, prefix, file)
        : "";
  return `<aside class="nav" id="menu">${rail(b, prefix, guide, file)}${side}</aside>`;
}
