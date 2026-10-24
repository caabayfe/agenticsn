import { anchorOf, type Evidence, type EvidenceStatus } from "./evidence";
import { escapeHtml } from "./html";
import { iconSvg } from "./icons";
import { recordHtml } from "./instance-links";
import type { DocPage, Section } from "./page";
import type { SiteConfig } from "./site-config";
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
export const OPEN_QUESTIONS = "it/open-questions.html";
// What changed for readers, from the release files (ADR-0039).
export const WHATS_NEW_EMPLOYEES = "employees/whats-new.html";
export const WHATS_NEW_IT = "it/whats-new.html";

export function sectionHome(process: string, section: Section): string {
  return `processes/${process}/${section}/index.html`;
}

// From a file to the site root: "" for index.html, "../../" for processes/<p>/index.html…
export function prefixOf(file: string): string {
  return "../".repeat(file.split("/").length - 1);
}

export interface Crumb {
  // Relative to the site root.
  readonly href: string;
  readonly text: string;
}

const TOGGLE = `<button class="navtoggle" type="button" aria-label="Menu" aria-controls="menu" aria-expanded="true">${iconSvg("menu")}</button>`;

// The site runs only its own scripts and styles, from files: a page's text can't add any, and a
// link can't lead to script (spec 012, B-08). Animations play in sandboxed frames of the site.
export const SITE_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; " +
  "frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

const script = (prefix: string, name: string) =>
  `<script src="${prefix}assets/${name}.js"></script>`;

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${SITE_POLICY}">
<title>${escapeHtml(title === config.title ? title : `${title} · ${config.title}`)}</title><link rel="stylesheet" href="${prefix}assets/site.css"><link rel="stylesheet" href="${prefix}assets/theme/theme.css"></head><body data-prefix="${prefix}">${aside === "" ? "" : script(prefix, "early")}<a class="skip" href="#main">Skip to the content</a>
<header class="site">${aside === "" ? "" : TOGGLE}<span class="logo" aria-hidden="true"></span><a class="home" href="${prefix}index.html">${escapeHtml(config.title)}</a>${trail === "" ? "" : `<nav class="crumbs" aria-label="Breadcrumb">${trail}</nav>`}</header>
<div class="shell">${aside}<div class="content">
<main id="main">
${main}
</main>
<footer class="site">${escapeHtml(config.footer)}</footer>
</div></div>
${script(prefix, "players")}${aside === "" ? "" : script(prefix, "search") + script(prefix, "menu")}
</body></html>
`;
}

function statusBadge(status: EvidenceStatus | undefined): string {
  const value = status ?? "unpinned";
  return `<span class="status status-${value}">${value}</span>`;
}

// Screen evidence names where it was seen; record evidence links to the record.
function anchorHtml(item: Evidence, instanceUrl: string | undefined): string {
  return item.kind === "record"
    ? recordHtml(instanceUrl, item.table, item.sysId, anchorOf(item))
    : `<code>${escapeHtml(anchorOf(item))}</code>`;
}

export function evidenceTable(
  evidence: readonly Evidence[],
  statuses: ReadonlyMap<string, EvidenceStatus>,
  instanceUrl?: string,
): string {
  const rows = evidence.map(
    (item) =>
      `<tr id="${item.id}"><td>${item.id}</td><td>${escapeHtml(item.how)}</td>` +
      `<td>${anchorHtml(item, instanceUrl)}</td><td>${escapeHtml(item.result)}</td>` +
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
