import { escapeHtml } from "./html";
import type { DocPage } from "./page";
import type { Process, ProcessCapability } from "./process";
import {
  type Built,
  bodyHtml,
  capabilitiesFor,
  checked,
  configureOf,
  guideCrumbs,
  link,
  roleNames,
  SECTION_TITLES,
  separated,
  staleOf,
  surfaceNames,
  understandPages,
  VIEW_SECTION,
  verification,
} from "./site-context";
import { type Crumb, layout, pageFile, prefixOf, sectionHome, staleNotice } from "./site-layout";
import { capabilityAudience } from "./structure";
import type { View } from "./views";

const KINDS: Readonly<Record<View, string>> = { user: "User guide", operator: "Operator guide" };

function crumbs(b: Built, process: Process, view: View): readonly Crumb[] {
  if (separated(b, view)) {
    return [...guideCrumbs(b, view), { href: sectionHome(process.id, "use"), text: process.title }];
  }
  return [
    ...guideCrumbs(b, view),
    { href: `processes/${process.id}/index.html`, text: process.title },
    { href: sectionHome(process.id, VIEW_SECTION[view]), text: SECTION_TITLES[VIEW_SECTION[view]] },
  ];
}

function banner(b: Built, kind: string, parts: readonly string[]): string {
  const spans = parts.filter((part) => part !== "").map((part) => `<span>${part}</span>`);
  return `<div class="banner"><span class="kind">${kind}</span>${spans.join("")}<span>${checked(b)}</span></div>`;
}

function pager(
  prefix: string,
  previous: { href: string; text: string } | undefined,
  middle: string,
  next: { href: string; text: string } | undefined,
): string {
  const side = (item: { href: string; text: string } | undefined, rel: "prev" | "next") =>
    item === undefined
      ? "<span></span>"
      : `<a rel="${rel}" href="${prefix}${item.href}">${rel === "prev" ? "← " : ""}${escapeHtml(item.text)}${rel === "next" ? " →" : ""}</a>`;
  return `<nav class="pager">${side(previous, "prev")}${middle}${side(next, "next")}</nav>`;
}

function counterpartHtml(
  b: Built,
  process: Process,
  capability: ProcessCapability,
  prefix: string,
) {
  const other = process.capabilities.find((item) => item.id === capability.counterpart);
  const audience = other === undefined ? null : capabilityAudience(process, other);
  if (other === undefined || (audience !== "user" && audience !== "operator")) {
    return "";
  }
  const page = b.page(process.id, VIEW_SECTION[audience], other.id);
  const title =
    page === undefined ? escapeHtml(other.title) : link(prefix, pageFile(page), other.title);
  return `<aside class="counterpart">On the other side, <strong>${escapeHtml(roleNames(process, other.roles))}</strong>: ${title}</aside>`;
}

// A Use or Operate page: one reader's steps for one capability.
export function guideHtml(b: Built, process: Process, page: DocPage, view: View): string {
  const file = pageFile(page);
  const prefix = prefixOf(file);
  const mine = capabilitiesFor(process, view);
  const index = mine.findIndex((capability) => capability.id === page.topic);
  const capability = mine[index];
  const configure = capability === undefined ? undefined : configureOf(b, process, capability);
  const near = (offset: number) => {
    const item = mine[index + offset];
    return item === undefined || index < 0
      ? undefined
      : {
          href: pageFile({ process: process.id, section: VIEW_SECTION[view], topic: item.id }),
          text: item.title,
        };
  };
  const config =
    configure === undefined || separated(b, view)
      ? ""
      : link(prefix, pageFile(configure), "How it is configured", "config");
  const main = `<h1>${index < 0 ? "" : `<span class="num">${index + 1}.</span> `}${escapeHtml(page.title)}</h1>
${banner(b, KINDS[view], [
  capability === undefined || capability.roles.length === 0
    ? ""
    : `For: ${escapeHtml(roleNames(process, capability.roles))}`,
  surfaceNames(b, view) === "" ? "" : `Where: ${escapeHtml(surfaceNames(b, view))}`,
])}
${staleNotice(staleOf(b, page, configure), "guide")}
${bodyHtml(b, page, file)}
${capability === undefined || separated(b, view) ? "" : counterpartHtml(b, process, capability, prefix)}
${verification(b, page, true)}
${pager(prefix, near(-1), config, near(1))}`;
  return layout(b.input.config, page.title, file, crumbs(b, process, view), main);
}

// A shared page, as one reader sees it.
export function understandHtml(b: Built, process: Process, page: DocPage, view: View): string {
  const file = pageFile(page, view);
  const prefix = prefixOf(file);
  const topics = understandPages(b, process);
  const index = topics.indexOf(page);
  const near = (offset: number) => {
    const item = topics[index + offset];
    return item === undefined ? undefined : { href: pageFile(item, view), text: item.title };
  };
  const main = `<h1>${escapeHtml(page.title)}</h1>
${banner(b, "How it works", [SECTION_TITLES[VIEW_SECTION[view]]])}
${staleNotice(staleOf(b, page), "guide")}
${bodyHtml(b, page, file, view)}
${verification(b, page, true)}
${pager(prefix, near(-1), "", near(1))}`;
  return layout(b.input.config, page.title, file, crumbs(b, process, view), main);
}

// A Configure page, with the guides it explains.
export function configureHtml(b: Built, process: Process, page: DocPage): string {
  const file = pageFile(page);
  const prefix = prefixOf(file);
  const guides = process.capabilities
    .filter((capability) => (capability.configure ?? capability.id) === page.topic)
    .flatMap((capability) => {
      const audience = capabilityAudience(process, capability);
      const guide =
        audience === "user" || audience === "operator"
          ? b.page(process.id, VIEW_SECTION[audience], capability.id)
          : undefined;
      return guide === undefined
        ? []
        : [
            link(
              prefix,
              pageFile(guide),
              `${KINDS[audience === "user" ? "user" : "operator"]}: ${guide.title}`,
            ),
          ];
    });
  const main = `<h1>${escapeHtml(page.title)}</h1>
<div class="banner"><span class="kind">Technical reference</span>${page.reviewed === undefined ? "" : `<span>Reviewed ${escapeHtml(page.reviewed)}</span>`}<span>${checked(b)}</span>${guides.join("")}</div>
${staleNotice(staleOf(b, page), "technical")}
${bodyHtml(b, page, file)}
${verification(b, page, false)}`;
  const trail: readonly Crumb[] = [
    ...guideCrumbs(b, "platform"),
    { href: `processes/${process.id}/index.html`, text: process.title },
    { href: sectionHome(process.id, "configure"), text: SECTION_TITLES.configure },
  ];
  return layout(b.input.config, page.title, file, trail, main);
}
