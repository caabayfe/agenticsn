import type { ConfigIndex } from "./config-index";
import type { EvidenceStatus } from "./evidence";
import { escapeHtml } from "./html";
import type { DocPage, Section } from "./page";
import type { PlayerMedia } from "./player";
import { OVERVIEW, type Process, type ProcessCapability } from "./process";
import { expandProse } from "./prose";
import type { Scene } from "./scene";
import type { SiteConfig } from "./site-config";
import { evidenceTable, prefixOf, staleIds } from "./site-layout";
import { capabilityAudience } from "./structure";
import { type View, viewOf } from "./views";

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
  // Audio tracks by animation name (phase 2); animations without one are silent.
  readonly media?: ReadonlyMap<string, { readonly player: PlayerMedia; readonly mp3: Uint8Array }>;
  // The configuration index of each process, by process id (spec 010a, A3).
  readonly indexes?: ReadonlyMap<string, ConfigIndex>;
}

export interface Built {
  readonly input: SiteInput;
  readonly scenes: ReadonlyMap<string, Scene>;
  page(process: string, section: Section, topic: string): DocPage | undefined;
}

export function built(input: SiteInput): Built {
  const byKey = new Map(
    input.pages.map((page) => [`${page.process}/${page.section}/${page.topic}`, page]),
  );
  return {
    input,
    scenes: new Map(input.scenes.map((scene) => [scene.name, scene])),
    page: (process, section, topic) => byKey.get(`${process}/${section}/${topic}`),
  };
}

export const SECTION_TITLES: Readonly<Record<Exclude<Section, "understand">, string>> = {
  use: "For end users",
  operate: "For operators",
  configure: "For the platform team",
};

export const VIEW_SECTION: Readonly<Record<View, "use" | "operate">> = {
  user: "use",
  operator: "operate",
};

// A reader's capabilities, in the order they meet them.
export function capabilitiesFor(process: Process, view: View): readonly ProcessCapability[] {
  return process.capabilities.filter(
    (capability) => capabilityAudience(process, capability) === view,
  );
}

// The shared topics in order: as process.yaml lists them, else the overview first.
export function understandPages(b: Built, process: Process): readonly DocPage[] {
  const pages = b.input.pages.filter(
    (page) => page.process === process.id && page.section === "understand",
  );
  const order =
    process.understand.length > 0
      ? process.understand
      : [
          OVERVIEW,
          ...pages
            .map((page) => page.topic)
            .filter((topic) => topic !== OVERVIEW)
            .sort(),
        ];
  return order.flatMap((topic) => pages.filter((page) => page.topic === topic));
}

// The Configure page that explains a capability.
export function configureOf(
  b: Built,
  process: Process,
  capability: ProcessCapability,
): DocPage | undefined {
  return b.page(process.id, "configure", capability.configure ?? capability.id);
}

// Configure pages in the order of the capabilities they explain, then the others.
export function configurePages(b: Built, process: Process): readonly DocPage[] {
  const ordered: DocPage[] = [];
  for (const capability of process.capabilities) {
    const page = configureOf(b, process, capability);
    if (page !== undefined && !ordered.includes(page)) {
      ordered.push(page);
    }
  }
  const rest = b.input.pages
    .filter((page) => page.process === process.id && page.section === "configure")
    .filter((page) => !ordered.includes(page))
    .sort((left, right) => left.topic.localeCompare(right.topic));
  return [...ordered, ...rest];
}

export function roleNames(process: Process, ids: readonly string[]): string {
  return ids.map((id) => process.roles.find((role) => role.id === id)?.name ?? id).join(", ");
}

export function checked(b: Built): string {
  const commit =
    b.input.mirrorCommit === null
      ? ""
      : ` (mirror ${escapeHtml(b.input.mirrorCommit.slice(0, 12))})`;
  return `Checked against ${escapeHtml(b.input.config.instance)} on ${escapeHtml(b.input.builtAt)}${commit}`;
}

export function surfaceNames(b: Built, view: View): string {
  return b.input.config.surfaces[view].map((surface) => surface.name).join(", ");
}

// The page's Markdown as HTML, in one reader's view for an Understand page.
export function bodyHtml(b: Built, page: DocPage, file: string, view?: View): string {
  const markdown = view === undefined ? page.body : viewOf(page.body, view);
  return b.input.markdown(
    expandProse(markdown, {
      evidence: new Set(page.evidence.map((item) => item.id)),
      citeTarget: null,
      scenes: b.scenes,
      prefix: prefixOf(file),
    }),
  );
}

export function verification(b: Built, page: DocPage, folded: boolean): string {
  if (page.evidence.length === 0) {
    return "";
  }
  const table = evidenceTable(page.evidence, b.input.statuses.get(page.path) ?? new Map());
  return folded
    ? `<details class="verified"><summary>How this page was checked (${page.evidence.length} records)</summary>${table}</details>`
    : `<h2 id="evidence">Evidence</h2>${table}`;
}

export function staleOf(b: Built, ...pages: readonly (DocPage | undefined)[]): readonly string[] {
  return pages.flatMap((page) =>
    page === undefined ? [] : staleIds(b.input.statuses.get(page.path)),
  );
}

export function link(prefix: string, href: string, text: string, className = ""): string {
  const attribute = className === "" ? "" : ` class="${className}"`;
  return `<a${attribute} href="${prefix}${href}">${escapeHtml(text)}</a>`;
}
