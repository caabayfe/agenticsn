import { anchorOf, type Evidence, type EvidenceStatus } from "./evidence";
import { escapeHtml } from "./html";
import { iconSvg } from "./icons";
import type { DocPage, Section } from "./page";
import type { SiteConfig } from "./site-config";
import { MENU_SCRIPT } from "./site-menu-script";
import type { View } from "./views";

// The section an Understand page is shown in, for each reader.
const VIEW_FOLDER: Readonly<Record<View, Section>> = { user: "use", operator: "operate" };

// Where each page lands in the site, relative to its root. An Understand page lands twice, once
// in each reader's section.
export function pageFile(
  page: Pick<DocPage, "process" | "section" | "topic">,
  view: View = "user",
): string {
  const folder = `processes/${page.process}`;
  return page.section === "understand"
    ? `${folder}/${VIEW_FOLDER[view]}/understand/${page.topic}.html`
    : `${folder}/${page.section}/${page.topic}.html`;
}

// The two guides' homes, when the site has an employee guide (ADR-0037).
export const EMPLOYEES_HOME = "employees/index.html";
export const IT_HOME = "it/index.html";

export function sectionHome(process: string, section: Section): string {
  return `processes/${process}/${section}/index.html`;
}

// From a file to the site root: "" for index.html, "../../" for processes/<p>/index.html…
export function prefixOf(file: string): string {
  return "../".repeat(file.split("/").length - 1);
}

// Talks to the players on the page; nothing else is accepted. Sizes each from its height message,
// remembers the reader's sound choice across pages (localStorage; a sandboxed player can't), and
// tells the players about the reader's first click, after which browsers allow sound.
const PLAYERS_SCRIPT =
  "<script>(function(){var K='snagentic-sound',on=false,act=false;try{on=localStorage.getItem(K)==='on';}catch(x){}" +
  "var all=function(){return document.querySelectorAll('iframe.player');};" +
  "var send=function(f,m){try{f.contentWindow.postMessage(m,'*');}catch(x){}};" +
  "addEventListener('message',function(e){all().forEach(function(f){if(e.source!==f.contentWindow||!e.data)return;" +
  "if(e.data.snagenticAnimH){f.style.height=e.data.snagenticAnimH+'px';send(f,{snagenticSoundPref:on});if(act)send(f,{snagenticActivate:true});}" +
  "if(typeof e.data.snagenticSound==='boolean'){on=e.data.snagenticSound;try{localStorage.setItem(K,on?'on':'off');}catch(x){}" +
  "all().forEach(function(g){send(g,{snagenticSoundPref:on});});}});});" +
  "var go=function(){if(act)return;act=true;all().forEach(function(f){send(f,{snagenticActivate:true});});};" +
  "addEventListener('pointerdown',go);addEventListener('keydown',go);})();</script>";

export interface Crumb {
  // Relative to the site root.
  readonly href: string;
  readonly text: string;
}

const TOGGLE = `<button class="navtoggle" type="button" aria-label="Hide or show the menu" aria-expanded="true">${iconSvg("menu")}</button>`;

// A page: the header, the menu beside the content when there is one (site-nav.ts), the footer.
export function layout(
  config: SiteConfig,
  title: string,
  file: string,
  crumbs: readonly Crumb[],
  main: string,
  aside = "",
): string {
  const prefix = prefixOf(file);
  const trail = crumbs
    .map((crumb) => `<a href="${prefix}${crumb.href}">${escapeHtml(crumb.text)}</a>`)
    .join(" › ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="${prefix}assets/site.css"></head><body data-prefix="${prefix}">
<header class="site">${aside === "" ? "" : TOGGLE}<a class="home" href="${prefix}index.html">${escapeHtml(config.title)}</a>${trail === "" ? "" : `<nav class="crumbs">${trail}</nav>`}</header>
<div class="shell">${aside}<div class="content">
<main>
${main}
</main>
<footer class="site">${escapeHtml(config.footer)}</footer>
</div></div>
${PLAYERS_SCRIPT}${aside === "" ? "" : `<script src="${prefix}assets/search.js"></script>${MENU_SCRIPT}`}
</body></html>
`;
}

function statusBadge(status: EvidenceStatus | undefined): string {
  const value = status ?? "unpinned";
  return `<span class="status status-${value}">${value}</span>`;
}

export function evidenceTable(
  evidence: readonly Evidence[],
  statuses: ReadonlyMap<string, EvidenceStatus>,
): string {
  const rows = evidence.map(
    (item) =>
      `<tr id="${item.id}"><td>${item.id}</td><td>${escapeHtml(item.how)}</td>` +
      `<td><code>${escapeHtml(anchorOf(item))}</code></td><td>${escapeHtml(item.result)}</td>` +
      `<td>${statusBadge(statuses.get(item.id))}</td></tr>`,
  );
  return (
    "<table><thead><tr><th>ID</th><th>How</th><th>Record</th><th>Result</th><th>Status</th></tr></thead>" +
    `<tbody>${rows.join("")}</tbody></table>`
  );
}

export function staleIds(
  statuses: ReadonlyMap<string, EvidenceStatus> | undefined,
): readonly string[] {
  return [...(statuses ?? [])]
    .filter(([, status]) => status === "changed" || status === "missing")
    .map(([id]) => id);
}

// Readers of a guide get a plain notice; the platform team gets the evidence that changed.
export function staleNotice(ids: readonly string[], kind: "guide" | "technical"): string {
  if (ids.length === 0) {
    return "";
  }
  if (kind === "guide") {
    return '<div class="stale">The platform changed since this guide was checked. Some steps may be out of date; the platform team has been told.</div>';
  }
  const links = ids.map((id) => `<a href="#${id}">${id}</a>`).join(", ");
  return `<div class="stale">The instance changed since this page was reviewed: ${links}. Parts of this page may be out of date.</div>`;
}
