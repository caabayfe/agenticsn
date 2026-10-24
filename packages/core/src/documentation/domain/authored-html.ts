import { mapProse } from "./prose";

// A page's text is written by an agent that may quote the instance word for word: an email, a
// description, a comment. Whoever can edit those on the instance must not be able to put script,
// markup or a script link on the published site (spec 012, B-08). The only HTML a page holds is
// what the page model adds, after this has run.

// A CommonMark autolink, <https://...> or <mailto:...>, is a link, not HTML.
const NOT_AN_AUTOLINK = /<(?!(?:https?:\/\/|mailto:)[^\s<>]*>)/g;

// Tags in prose are shown as text; code is left to the renderer, which escapes it.
export function withoutAuthorHtml(markdown: string): string {
  return mapProse(markdown, (prose) => prose.replace(NOT_AN_AUTOLINK, "&lt;"));
}

const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|lt|gt|apos));/gi;
const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  lt: "<",
  gt: ">",
  apos: "'",
};

function decoded(value: string): string {
  return value.replace(ENTITY, (all, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED[name.toLowerCase()] ?? all;
    const code = decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number(decimal);
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

// Browsers drop tabs, line breaks and leading controls in a URL, so "java\tscript:" is a scheme.
const withoutControls = (text: string) =>
  [...text].filter((character) => (character.codePointAt(0) ?? 0) > 0x20).join("");

function allowed(address: string): boolean {
  const scheme = SCHEME.exec(withoutControls(decoded(address)))?.[1];
  return scheme === undefined || ALLOWED_SCHEMES.has(scheme.toLowerCase());
}

const ADDRESS = /\s(?:href|src)="([^"]*)"/g;

// Rendered HTML with every link and image address that has another scheme (javascript:, data:,
// vbscript:...) removed: the element stays, inert.
export function safeLinks(html: string): string {
  return html.replace(ADDRESS, (attribute, address: string) => (allowed(address) ? attribute : ""));
}
