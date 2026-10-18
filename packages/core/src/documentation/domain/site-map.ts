import { employeePage } from "./employee-guide";
import { escapeHtml } from "./html";
import { iconSvg } from "./icons";
import type { Process } from "./process";
import { type Built, capabilitiesFor, checked, configurePages, link } from "./site-context";
import { EMPLOYEES_HOME, IT_HOME, layout, pageFile, prefixOf, sectionHome } from "./site-layout";
import { navFor } from "./site-nav";

interface Card {
  readonly icon: string | undefined;
  readonly title: string;
  readonly href?: string;
  readonly summary: string;
  readonly links: readonly { readonly href: string; readonly text: string }[];
}

function cardHtml(prefix: string, card: Card): string {
  const title =
    card.href === undefined ? escapeHtml(card.title) : link(prefix, card.href, card.title);
  const items = card.links.map((item) => `<li>${link(prefix, item.href, item.text)}</li>`);
  return `<div class="card"><h3>${iconSvg(card.icon)}${title}</h3>${card.summary === "" ? "" : `<p class="mute">${escapeHtml(card.summary)}</p>`}<ul>${items.join("")}</ul></div>`;
}

const pagesFor = (b: Built, targets: readonly string[]) =>
  targets.flatMap((target) => {
    const page = employeePage(target, b.input.pages);
    return page === undefined ? [] : [{ href: pageFile(page, "user"), text: page.title }];
  });

function employeeCards(b: Built, processes: readonly Process[]): readonly Card[] {
  const guide = b.input.config.employees;
  if (guide === undefined) {
    return [];
  }
  return [
    { icon: "home", title: "Start here", summary: guide.intro, links: pagesFor(b, guide.start) },
    ...guide.tasks.map((task) => ({
      icon: task.icon,
      title: task.title,
      summary: task.summary,
      links: pagesFor(b, task.pages),
    })),
    {
      icon: "book",
      title: "How it works",
      summary: "Each process in plain words.",
      links: processes.map((process) => ({
        href: sectionHome(process.id, "use"),
        text: process.title,
      })),
    },
  ];
}

function processCard(b: Built, process: Process): Card {
  const views =
    b.input.config.employees === undefined
      ? (["user", "operator"] as const)
      : (["operator"] as const);
  const links = views.flatMap((view) =>
    capabilitiesFor(process, view).flatMap((capability) => {
      const page = b.page(process.id, view === "user" ? "use" : "operate", capability.id);
      return page === undefined ? [] : [{ href: pageFile(page), text: page.title }];
    }),
  );
  return {
    icon: process.icon,
    title: process.title,
    href: `processes/${process.id}/index.html`,
    summary: process.summary,
    links: [
      ...links,
      ...(configurePages(b, process).length > 0
        ? [{ href: sectionHome(process.id, "configure"), text: "How it is configured" }]
        : []),
    ],
  };
}

// The IT guide's cards. Beside an employee guide, a process with nothing for IT (such as the
// employees' getting-help) is left out.
const itCards = (b: Built, processes: readonly Process[]): readonly Card[] =>
  processes
    .map((process) => processCard(b, process))
    .filter((card) => b.input.config.employees === undefined || card.links.length > 0);

const section = (prefix: string, cards: readonly Card[]) =>
  `<section class="map">${cards.map((card) => cardHtml(prefix, card)).join("")}</section>`;

// The site map: every group of pages as a card, so any page is one click from the front page.
export function siteMapHtml(b: Built, processes: readonly Process[]): string {
  const guide = b.input.config.employees;
  const it = itCards(b, processes);
  const body =
    guide === undefined
      ? section("", it)
      : `<h2>${link("", EMPLOYEES_HOME, guide.title)}</h2>${section("", employeeCards(b, processes))}
<h2>${link("", IT_HOME, "IT guide")}</h2>${section("", it)}`;
  const main = `<h1>${escapeHtml(b.input.config.title)}</h1>
<div class="banner"><span>${checked(b)}</span></div>
${body}`;
  return layout(
    b.input.config,
    b.input.config.title,
    "index.html",
    [],
    main,
    navFor(b, "index.html"),
  );
}

// The IT guide's home: a card per process.
export function itHomeHtml(b: Built, processes: readonly Process[]): string {
  const prefix = prefixOf(IT_HOME);
  const main = `<h1>IT guide</h1>
<p class="lead">For operators and the platform team: each process step by step, and how it is configured.</p>
<div class="banner"><span>${checked(b)}</span></div>
${section(prefix, itCards(b, processes))}`;
  return layout(b.input.config, "IT guide", IT_HOME, [], main, navFor(b, IT_HOME));
}
