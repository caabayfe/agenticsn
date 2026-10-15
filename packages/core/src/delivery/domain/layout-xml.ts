// What every layout update shares: the XML the ServiceNow SDK's build writes (xmlbuilder2, pretty
// printed, two-space indent, an empty value as a self-closing element), and the view a layout
// belongs to (ADR-0029, ADR-0030). Pure.

export const DEFAULT_VIEW = "Default view";

// The Default view's sys_id is literally "Default view"; any other view is named too.
export interface LayoutView {
  readonly sysId: string;
  readonly name: string;
}

export const isDefaultView = (view: LayoutView) => view.sysId === DEFAULT_VIEW;

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
// Text escapes &, < and >; an attribute value also escapes the double quote.
const escapeText = (value: string) => value.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c);
const escapeAttribute = (value: string) => value.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

export const attributes = (values: readonly (readonly [string, string])[]) =>
  values.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");

export const element = (indent: string, name: string, text: string, attrs = "") =>
  text === ""
    ? `${indent}<${name}${attrs}/>`
    : `${indent}<${name}${attrs}>${escapeText(text)}</${name}>`;

// <?xml?><record_update><wrapper …>…</wrapper></record_update>, as the SDK's composites are.
export const compositeUpdate = (wrapper: string, attrs: string, body: readonly string[]) =>
  [
    '<?xml version="1.0"?>',
    "<record_update>",
    `  <${wrapper}${attrs}>`,
    ...body,
    `  </${wrapper}>`,
    "</record_update>",
  ].join("\n");

export const INSERT_OR_UPDATE = attributes([
  ["action", "INSERT_OR_UPDATE"],
  ["apply_defaults", "true"],
]);

// Rows in the order the layout shows them.
export const byPosition = <T extends { readonly position: string }>(a: T, b: T) =>
  Number(a.position) - Number(b.position);
