import { escapeHtml } from "./html";
import type { Scene } from "./scene";

export const LABELS = [
  "NEW",
  "CORRECTED",
  "RESTORED",
  "CHANGED",
  "DOCUMENTED-ONLY",
  "OPEN-QUESTION",
] as const;
export type Label = (typeof LABELS)[number];

// A link to another page, [text](see:<target>), resolved by references.ts (spec 010b).
export const SEE_LINK = /\]\(see:([a-z0-9/-]*)\)/g;

// Code (fenced blocks and inline spans) is left as written; only prose is transformed.
const CODE = /(^(```|~~~)[\s\S]*?^\2[^\n]*$|`[^`\n]*`)/gm;

export function mapProse(markdown: string, transform: (prose: string) => string): string {
  let out = "";
  let last = 0;
  for (const match of markdown.matchAll(CODE)) {
    out += transform(markdown.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + transform(markdown.slice(last));
}

export function animationsOf(markdown: string): readonly string[] {
  const names: string[] = [];
  mapProse(markdown, (prose) => {
    for (const match of prose.matchAll(/^\{\{animation:([a-z0-9]+)\}\}\s*$/gm)) {
      names.push(match[1] ?? "");
    }
    return prose;
  });
  return [...new Set(names)];
}

function labelHtml(label: string): string {
  const known = LABELS.find((candidate) => candidate === label.toUpperCase());
  const text = (known ?? label).replace("-", " ");
  return `<span class="label label-${(known ?? "unknown").toLowerCase()}">${escapeHtml(text)}</span>`;
}

export function transcriptHtml(scene: Scene): string {
  const items = scene.steps.map(
    (step) => `<li><strong>${escapeHtml(step.t)}.</strong> ${escapeHtml(step.sub)}</li>`,
  );
  return `<details class="transcript"><summary>Transcript (${scene.steps.length} steps)</summary><ol>${items.join("")}</ol></details>`;
}

function animationHtml(
  scene: Scene | undefined,
  name: string,
  prefix: string,
  video: boolean,
): string {
  if (scene === undefined) {
    return `<p class="missing">Animation ${escapeHtml(name)} is missing.</p>`;
  }
  const title = escapeHtml(`Animation: ${scene.title}`);
  return (
    `<div class="animation"><iframe class="player" data-animation="${name}" src="${prefix}animations/${name}.html" ` +
    `sandbox="allow-scripts" allow="autoplay" loading="lazy" title="${title}"></iframe>${transcriptHtml(scene)}` +
    (video
      ? `<p class="video"><a href="${prefix}animations/${name}.mp4" download>Download the video (MP4)</a></p>`
      : "") +
    "</div>"
  );
}

export interface ProseContext {
  // Evidence ids listed on this page; other citations link to `citeTarget`.
  readonly evidence: ReadonlySet<string>;
  readonly citeTarget: string | null;
  readonly scenes: ReadonlyMap<string, Scene>;
  // Path from the page to the site root ("../" for pages/).
  readonly prefix: string;
  // The address of a see: link's target, or null when it leads nowhere (spec 010b).
  readonly link?: (target: string) => string | null;
  // Animations rendered as MP4 beside the site (spec 010c).
  readonly videos?: ReadonlySet<string>;
}

function cite(id: string, context: ProseContext): string {
  if (context.evidence.has(id)) {
    return `<a class="cite" href="#${id}">${id}</a>`;
  }
  return context.citeTarget === null
    ? `<span class="cite unknown">${id}</span>`
    : `<a class="cite" href="${context.citeTarget}#${id}">${id}</a>`;
}

// Labels on headings, citations and animation blocks, as HTML inside the Markdown, which the
// renderer passes through.
export function expandProse(markdown: string, context: ProseContext): string {
  return mapProse(markdown, (prose) =>
    prose
      .replace(
        /^(#{1,6} .*?)\s*\{label=([A-Za-z-]+)\}\s*$/gm,
        (_, heading: string, label: string) => `${heading} ${labelHtml(label)}`,
      )
      .replace(/\[(E\d+)\]/g, (_, id: string) => cite(id, context))
      .replace(SEE_LINK, (_, target: string) => `](${context.link?.(target) ?? "#unknown-link"})`)
      .replace(
        /^\{\{animation:([a-z0-9]+)\}\}\s*$/gm,
        (_, name: string) =>
          `\n${animationHtml(context.scenes.get(name), name, context.prefix, context.videos?.has(name) === true)}\n`,
      ),
  );
}
