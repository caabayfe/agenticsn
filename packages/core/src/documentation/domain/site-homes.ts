import { escapeHtml } from "./html";
import type { Process } from "./process";
import {
  type Built,
  capabilitiesFor,
  checked,
  configurePages,
  guideCrumbs,
  link,
  SECTION_TITLES,
  surfaceNames,
  understandPages,
  VIEW_SECTION,
} from "./site-context";
import { recordsFile } from "./site-index";
import { layout, pageFile, prefixOf, sectionHome } from "./site-layout";
import { navFor } from "./site-nav";
import type { View } from "./views";

const DOOR_TEXT: Readonly<Record<View, string>> = {
  user: "Ask for help and follow it through",
  operator: "Log, route, work and resolve",
};

export function door(href: string, title: string, lines: readonly string[]): string {
  const spans = lines
    .filter((line) => line !== "")
    .map((line) => `<span>${escapeHtml(line)}</span>`);
  return `<a class="door" href="${href}"><strong>${escapeHtml(title)}</strong>${spans.join("")}</a>`;
}

function viewDoor(b: Built, process: Process, view: View): string {
  const roles = process.roles.filter((role) => role.audience === view).map((role) => role.name);
  const surfaces = surfaceNames(b, view);
  return door(
    sectionHome(process.id, VIEW_SECTION[view]).slice(`processes/${process.id}/`.length),
    SECTION_TITLES[VIEW_SECTION[view]],
    [DOOR_TEXT[view], roles.join(", "), surfaces === "" ? "" : `In ${surfaces}`],
  );
}

// The process: what it is for, its lifecycle, and a door for each reader.
export function processHtml(b: Built, process: Process): string {
  const file = `processes/${process.id}/index.html`;
  const states = process.lifecycle.map(
    (state) =>
      `<li><strong>${escapeHtml(state.state)}</strong><span>${escapeHtml(state.meaning)}</span></li>`,
  );
  const main = `<h1>${escapeHtml(process.title)}</h1>
<p class="lead">${escapeHtml(process.summary)}</p>
<div class="banner"><span>${checked(b)}</span></div>
<div class="doors">${viewDoor(b, process, "user")}${viewDoor(b, process, "operator")}${door("configure/index.html", SECTION_TITLES.configure, ["The business rules, ACLs, scripts and other records behind each step"])}</div>
${states.length === 0 ? "" : `<h2>Lifecycle</h2><ol class="lifecycle">${states.join("")}</ol>`}`;
  return layout(
    b.input.config,
    process.title,
    file,
    guideCrumbs(b, "platform"),
    main,
    navFor(b, file),
  );
}

// A reader's home: who they are, the shared topics in their view, and their capabilities.
export function viewHomeHtml(b: Built, process: Process, view: View): string {
  const section = VIEW_SECTION[view];
  const file = sectionHome(process.id, section);
  const prefix = prefixOf(file);
  const roles = process.roles
    .filter((role) => role.audience === view)
    .map(
      (role) =>
        `<li><strong>${escapeHtml(role.name)}</strong>${role.description === "" ? "" : ` — ${escapeHtml(role.description)}`}</li>`,
    );
  const topics = understandPages(b, process).map(
    (page) => `<li>${link(prefix, pageFile(page, view), page.title)}</li>`,
  );
  const steps = capabilitiesFor(process, view).map((capability, index) => {
    const page = b.page(process.id, section, capability.id);
    const title =
      page === undefined
        ? escapeHtml(capability.title)
        : link(prefix, pageFile(page), capability.title);
    return `<li><span class="num">${index + 1}.</span> ${title}<br><span class="mute">${escapeHtml(capability.summary)}</span></li>`;
  });
  const surfaces = surfaceNames(b, view);
  const main = `<h1>${escapeHtml(process.title)}: ${escapeHtml(SECTION_TITLES[section].toLowerCase())}</h1>
<p class="lead">${escapeHtml(process.summary)}</p>
<div class="banner">${surfaces === "" ? "" : `<span>Where: ${escapeHtml(surfaces)}</span>`}<span>${checked(b)}</span></div>
${roles.length === 0 ? "" : `<h2>Who this is for</h2><ul class="roles">${roles.join("")}</ul>`}
${topics.length === 0 ? "" : `<h2>How it works</h2><ul class="pages">${topics.join("")}</ul>`}
<h2>What you can do</h2><ul class="pages">${steps.join("")}</ul>`;
  return layout(
    b.input.config,
    `${process.title}: ${SECTION_TITLES[section]}`,
    file,
    view === "user" && b.input.config.employees !== undefined
      ? guideCrumbs(b, view)
      : [
          ...guideCrumbs(b, view),
          { href: `processes/${process.id}/index.html`, text: process.title },
        ],
    main,
    navFor(b, file),
  );
}

// The platform team's home: every Configure page, in the order of the capabilities.
export function configureHomeHtml(b: Built, process: Process): string {
  const file = sectionHome(process.id, "configure");
  const prefix = prefixOf(file);
  const items = configurePages(b, process).map(
    (page) =>
      `<li>${link(prefix, pageFile(page), page.title)}<br><span class="mute">${page.evidence.length} evidence records</span></li>`,
  );
  const main = `<h1>${escapeHtml(process.title)}: ${escapeHtml(SECTION_TITLES.configure.toLowerCase())}</h1>
<div class="banner"><span class="kind">Technical reference</span><span>${checked(b)}</span></div>
<ul class="pages">${items.join("")}</ul>
${b.input.indexes?.has(process.id) === true ? `<p>${link(prefix, recordsFile(process.id), "Configuration index: every record behind this process, and what isn't documented yet")}</p>` : ""}`;
  return layout(
    b.input.config,
    `${process.title}: ${SECTION_TITLES.configure}`,
    file,
    [
      ...guideCrumbs(b, "platform"),
      { href: `processes/${process.id}/index.html`, text: process.title },
    ],
    main,
    navFor(b, file),
  );
}
