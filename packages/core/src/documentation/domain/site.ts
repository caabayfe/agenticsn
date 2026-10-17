import type { EvidenceStatus } from "./evidence";
import { escapeHtml } from "./html";
import type { DocPage } from "./page";
import { playerHtml } from "./player";
import { OVERVIEW, type Process, type ProcessCapability } from "./process";
import { expandProse } from "./prose";
import type { Scene } from "./scene";
import type { SiteConfig } from "./site-config";
import { evidenceTable, layout, pageFile, staleIds, staleNotice } from "./site-layout";
import { SITE_STYLE } from "./site-style";

export interface SiteFile {
  // Relative to the site's root folder.
  readonly path: string;
  readonly content: string;
}

export interface SiteInput {
  readonly config: SiteConfig;
  readonly processes: readonly Process[];
  readonly pages: readonly DocPage[];
  readonly scenes: readonly Scene[];
  // Evidence status per page path, then per evidence id, as checked against the mirror.
  readonly statuses: ReadonlyMap<string, ReadonlyMap<string, EvidenceStatus>>;
  readonly markdown: (source: string) => string;
  // When the site was built and the mirror commit it was checked against.
  readonly builtAt: string;
  readonly mirrorCommit: string | null;
}

const PREFIX = "../../";

interface Built {
  readonly input: SiteInput;
  readonly scenes: ReadonlyMap<string, Scene>;
  page(process: string, capability: string, audience: DocPage["audience"]): DocPage | undefined;
}

function body(built: Built, page: DocPage): string {
  const technical = built.page(page.process, page.capability, "technical");
  const citeTarget =
    page.audience === "guide" && technical !== undefined ? `${PREFIX}${pageFile(technical)}` : null;
  return built.input.markdown(
    expandProse(page.body, {
      evidence: new Set(page.evidence.map((item) => item.id)),
      citeTarget,
      scenes: built.scenes,
      prefix: PREFIX,
    }),
  );
}

function roleNames(process: Process, ids: readonly string[]): string {
  return ids.map((id) => process.roles.find((role) => role.id === id)?.name ?? id).join(", ");
}

function checked(built: Built): string {
  const commit =
    built.input.mirrorCommit === null
      ? ""
      : ` (mirror ${escapeHtml(built.input.mirrorCommit.slice(0, 12))})`;
  return `Checked against ${escapeHtml(built.input.config.instance)} on ${escapeHtml(built.input.builtAt)}${commit}`;
}

function verification(built: Built, page: DocPage): string {
  const statuses = built.input.statuses.get(page.path) ?? new Map<string, EvidenceStatus>();
  if (page.evidence.length === 0) {
    return "";
  }
  const table = evidenceTable(page.evidence, statuses);
  return page.audience === "technical"
    ? `<h2 id="evidence">Evidence</h2>${table}`
    : `<details class="verified"><summary>How this guide was checked (${page.evidence.length} records)</summary>${table}</details>`;
}

function capabilityNav(built: Built, process: Process, index: number): string {
  const link = (capability: ProcessCapability | undefined, rel: string) =>
    capability === undefined
      ? "<span></span>"
      : `<a rel="${rel}" href="${capability.id}.html">${rel === "prev" ? "← " : ""}${escapeHtml(capability.title)}${rel === "next" ? " →" : ""}</a>`;
  const technical = built.page(process.id, process.capabilities[index]?.id ?? "", "technical");
  const config =
    technical === undefined
      ? ""
      : `<a class="config" href="${process.capabilities[index]?.id}.technical.html">How it is configured</a>`;
  return `<nav class="pager">${link(process.capabilities[index - 1], "prev")}${config}${link(process.capabilities[index + 1], "next")}</nav>`;
}

function guideHtml(built: Built, process: Process, page: DocPage): string {
  const index = process.capabilities.findIndex((capability) => capability.id === page.capability);
  const capability = process.capabilities[index];
  const technical = built.page(page.process, page.capability, "technical");
  const stale = [
    ...staleIds(built.input.statuses.get(page.path)),
    ...(technical === undefined ? [] : staleIds(built.input.statuses.get(technical.path))),
  ];
  const main = `<h1><span class="num">${index + 1}.</span> ${escapeHtml(page.title)}</h1>
<div class="banner"><span class="kind">User guide</span>${capability === undefined || capability.roles.length === 0 ? "" : `<span>For: ${escapeHtml(roleNames(process, capability.roles))}</span>`}<span>${checked(built)}</span></div>
${staleNotice(stale, "guide")}
${body(built, page)}
${verification(built, page)}
${capabilityNav(built, process, index)}`;
  return layout(
    built.input.config,
    page.title,
    PREFIX,
    [{ href: "index.html", text: process.title }],
    main,
  );
}

function technicalHtml(built: Built, process: Process, page: DocPage): string {
  const guide = built.page(page.process, page.capability, "guide");
  const back =
    guide === undefined
      ? ""
      : `<a href="${PREFIX}${pageFile(guide)}">User guide: ${escapeHtml(guide.title)}</a>`;
  const main = `<h1>${escapeHtml(page.title)}</h1>
<div class="banner"><span class="kind">Technical reference</span>${page.reviewed === undefined ? "" : `<span>Reviewed ${escapeHtml(page.reviewed)}</span>`}<span>${checked(built)}</span>${back}</div>
${staleNotice(staleIds(built.input.statuses.get(page.path)), "technical")}
${body(built, page)}
${verification(built, page)}`;
  return layout(
    built.input.config,
    page.title,
    PREFIX,
    [{ href: "index.html", text: process.title }],
    main,
  );
}

function processHtml(built: Built, process: Process): string {
  const overview = built.page(process.id, OVERVIEW, "guide");
  const roles = process.roles.map((role) => {
    const mine = process.capabilities.filter((capability) => capability.roles.includes(role.id));
    const links = mine
      .map((capability) => `<a href="${capability.id}.html">${escapeHtml(capability.title)}</a>`)
      .join(", ");
    return `<li><strong>${escapeHtml(role.name)}</strong>${role.description === "" ? "" : ` — ${escapeHtml(role.description)}`}${links === "" ? "" : `<br><span class="mute">Start with:</span> ${links}`}</li>`;
  });
  const states = process.lifecycle.map(
    (state) =>
      `<li><strong>${escapeHtml(state.state)}</strong><span>${escapeHtml(state.meaning)}</span></li>`,
  );
  const steps = process.capabilities.map((capability, index) => {
    const technical =
      built.page(process.id, capability.id, "technical") === undefined
        ? ""
        : ` <a class="config" href="${capability.id}.technical.html">configuration</a>`;
    const guide =
      built.page(process.id, capability.id, "guide") === undefined
        ? escapeHtml(capability.title)
        : `<a href="${capability.id}.html">${escapeHtml(capability.title)}</a>`;
    return `<li><span class="num">${index + 1}.</span> ${guide}${technical}<br><span class="mute">${escapeHtml(capability.summary)}</span></li>`;
  });
  const overviewTechnical = built.page(process.id, OVERVIEW, "technical");
  const main = `<h1>${escapeHtml(process.title)}</h1>
<p class="lead">${escapeHtml(process.summary)}</p>
<div class="banner"><span class="kind">User guide</span><span>${checked(built)}</span>${overviewTechnical === undefined ? "" : `<a href="overview.technical.html">How the process is configured</a>`}</div>
${roles.length === 0 ? "" : `<h2>Who this is for</h2><ul class="roles">${roles.join("")}</ul>`}
${states.length === 0 ? "" : `<h2>Lifecycle</h2><ol class="lifecycle">${states.join("")}</ol>`}
${overview === undefined ? "" : body(built, overview)}
<h2>What you can do</h2><ul class="pages">${steps.join("")}</ul>`;
  return layout(built.input.config, process.title, PREFIX, [], main);
}

function indexHtml(built: Built, processes: readonly Process[]): string {
  const items = processes.map(
    (process) =>
      `<li><a href="processes/${process.id}/index.html">${escapeHtml(process.title)}</a><br><span class="mute">${escapeHtml(process.summary)}</span></li>`,
  );
  const main = `<h1>${escapeHtml(built.input.config.title)}</h1>
<div class="banner"><span>${checked(built)}</span></div>
<h2>Processes</h2><ul class="pages">${items.join("")}</ul>`;
  return layout(built.input.config, built.input.config.title, "", [], main);
}

// Every file of the static site: index, a page per process, the guide and technical page of
// each capability, the animations and the stylesheet.
export function siteFiles(input: SiteInput): readonly SiteFile[] {
  const byKey = new Map(
    input.pages.map((page) => [`${page.process}/${page.capability}/${page.audience}`, page]),
  );
  const built: Built = {
    input,
    scenes: new Map(input.scenes.map((scene) => [scene.name, scene])),
    page: (process, capability, audience) => byKey.get(`${process}/${capability}/${audience}`),
  };
  const processes = [...input.processes].sort(
    (left, right) => left.order - right.order || left.title.localeCompare(right.title),
  );
  const files: SiteFile[] = [
    { path: "index.html", content: indexHtml(built, processes) },
    { path: "assets/site.css", content: SITE_STYLE },
  ];
  for (const process of processes) {
    files.push({
      path: `processes/${process.id}/index.html`,
      content: processHtml(built, process),
    });
    for (const page of input.pages.filter((candidate) => candidate.process === process.id)) {
      if (page.audience === "technical") {
        files.push({ path: pageFile(page), content: technicalHtml(built, process, page) });
      } else if (page.capability !== OVERVIEW) {
        files.push({ path: pageFile(page), content: guideHtml(built, process, page) });
      }
    }
  }
  for (const scene of input.scenes) {
    files.push({ path: `animations/${scene.name}.html`, content: playerHtml(scene) });
  }
  return files;
}
