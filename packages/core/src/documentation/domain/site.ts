import { anchorOf, type Evidence, type EvidenceStatus } from "./evidence";
import { escapeHtml } from "./html";
import type { DocPage } from "./page";
import { playerHtml } from "./player";
import { expandProse } from "./prose";
import type { Scene } from "./scene";
import type { SiteConfig } from "./site-config";
import { SITE_STYLE } from "./site-style";

export interface SiteFile {
  // Relative to the site's root folder.
  readonly path: string;
  readonly content: string;
}

export interface SiteInput {
  readonly config: SiteConfig;
  readonly pages: readonly DocPage[];
  readonly scenes: readonly Scene[];
  // Evidence status per page path, then per evidence id, as checked against the mirror.
  readonly statuses: ReadonlyMap<string, ReadonlyMap<string, EvidenceStatus>>;
  readonly markdown: (source: string) => string;
  // When the site was built and the mirror commit it was checked against.
  readonly builtAt: string;
  readonly mirrorCommit: string | null;
}

const AUDIENCE_NAMES = { guide: "User guide", technical: "Technical reference" } as const;

export function pageFile(page: DocPage): string {
  const leaf = page.path.slice(page.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return `pages/${leaf}.html`;
}

// Shown to the embedding page by the player's height messages; nothing else is accepted.
const RESIZE_SCRIPT =
  "<script>addEventListener('message',function(e){document.querySelectorAll('iframe.player').forEach(function(f){" +
  "if(e.source===f.contentWindow&&e.data&&e.data.snagenticAnimH){f.style.height=e.data.snagenticAnimH+'px';}});});</script>";

function layout(config: SiteConfig, title: string, prefix: string, main: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="${prefix}assets/site.css"></head><body>
<header class="site"><a href="${prefix}index.html">${escapeHtml(config.title)}</a></header>
<main>
${main}
</main>
<footer class="site">${escapeHtml(config.footer)}</footer>
${RESIZE_SCRIPT}
</body></html>
`;
}

function statusBadge(status: EvidenceStatus | undefined): string {
  const value = status ?? "unpinned";
  return `<span class="status status-${value}">${value}</span>`;
}

function evidenceTable(
  evidence: readonly Evidence[],
  statuses: ReadonlyMap<string, EvidenceStatus>,
) {
  const rows = evidence.map(
    (item) =>
      `<tr id="${item.id}"><td>${item.id}</td><td>${escapeHtml(item.how)}</td>` +
      `<td><code>${escapeHtml(anchorOf(item))}</code></td><td>${escapeHtml(item.result)}</td>` +
      `<td>${statusBadge(statuses.get(item.id))}</td></tr>`,
  );
  return (
    '<h2 id="evidence">Evidence</h2><table><thead><tr><th>ID</th><th>How</th><th>Record</th>' +
    `<th>Result</th><th>Status</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
  );
}

function staleNotice(statuses: ReadonlyMap<string, EvidenceStatus>): string {
  const stale = [...statuses].filter(([, status]) => status === "changed" || status === "missing");
  if (stale.length === 0) {
    return "";
  }
  const ids = stale.map(([id]) => `<a href="#${id}">${id}</a>`).join(", ");
  return `<div class="stale">The instance changed since this page was reviewed: ${ids}. Parts of this page may be out of date.</div>`;
}

function banner(page: DocPage, pair: DocPage | undefined, input: SiteInput): string {
  const parts = [`<span class="kind">${AUDIENCE_NAMES[page.audience]}</span>`];
  if (page.reviewed !== undefined) {
    parts.push(`<span>Reviewed ${escapeHtml(page.reviewed)}</span>`);
  }
  parts.push(
    `<span>Checked against ${escapeHtml(input.config.instance)} on ${escapeHtml(input.builtAt)}</span>`,
  );
  if (pair !== undefined) {
    const name = AUDIENCE_NAMES[pair.audience];
    parts.push(`<a href="../${pageFile(pair)}">${name}: ${escapeHtml(pair.title)}</a>`);
  }
  return `<div class="banner">${parts.join("")}</div>`;
}

function pageHtml(page: DocPage, input: SiteInput, scenes: ReadonlyMap<string, Scene>): string {
  const byCode = new Map(input.pages.map((candidate) => [candidate.code, candidate]));
  const pair = page.pair === undefined ? undefined : byCode.get(page.pair);
  const statuses = input.statuses.get(page.path) ?? new Map<string, EvidenceStatus>();
  const body = input.markdown(
    expandProse(page.body, {
      evidence: new Set(page.evidence.map((item) => item.id)),
      citeTarget: pair === undefined ? null : `../${pageFile(pair)}`,
      scenes,
      prefix: "../",
    }),
  );
  const evidence = page.evidence.length === 0 ? "" : evidenceTable(page.evidence, statuses);
  const main = `<h1>${escapeHtml(page.code)} ${escapeHtml(page.title)}</h1>
${banner(page, pair, input)}
${staleNotice(statuses)}
${body}
${evidence}`;
  return layout(input.config, `${page.code} ${page.title}`, "../", main);
}

const byCode = (left: DocPage, right: DocPage) =>
  left.code.localeCompare(right.code, "en", { numeric: true });

function indexHtml(input: SiteInput): string {
  const sections = (["guide", "technical"] as const).map((audience) => {
    const items = input.pages
      .filter((page) => page.audience === audience)
      .sort(byCode)
      .map(
        (page) =>
          `<li><span class="code">${escapeHtml(page.code)}</span> <a href="${pageFile(page)}">${escapeHtml(page.title)}</a></li>`,
      );
    return items.length === 0
      ? ""
      : `<h2>${AUDIENCE_NAMES[audience]}</h2><ul class="pages">${items.join("")}</ul>`;
  });
  const commit =
    input.mirrorCommit === null
      ? ""
      : ` (mirror commit ${escapeHtml(input.mirrorCommit.slice(0, 12))})`;
  const main = `<h1>${escapeHtml(input.config.title)}</h1>
<div class="banner"><span>Checked against ${escapeHtml(input.config.instance)} on ${escapeHtml(input.builtAt)}${commit}</span></div>
${sections.join("\n")}`;
  return layout(input.config, input.config.title, "", main);
}

// Every file of the static site: index, pages, animations and the stylesheet.
export function siteFiles(input: SiteInput): readonly SiteFile[] {
  const scenes = new Map(input.scenes.map((scene) => [scene.name, scene]));
  return [
    { path: "index.html", content: indexHtml(input) },
    { path: "assets/site.css", content: SITE_STYLE },
    ...input.pages.map((page) => ({
      path: pageFile(page),
      content: pageHtml(page, input, scenes),
    })),
    ...input.scenes.map((scene) => ({
      path: `animations/${scene.name}.html`,
      content: playerHtml(scene),
    })),
  ];
}
