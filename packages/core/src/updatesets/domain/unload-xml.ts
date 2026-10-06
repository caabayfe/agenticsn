// ServiceNow's XML unload format, as written by "Export to XML": one element per record, one
// child element per field in alphabetical order; reference fields carry their display value
// as an attribute; empty fields are self-closing. A value with markup characters is wrapped
// in CDATA, unless it contains "]]>" (which cannot appear in CDATA): then it is escaped.

export interface UnloadField {
  readonly name: string;
  readonly value: string;
  // Set for reference fields, even when empty.
  readonly display?: string;
}

export interface UnloadRecord {
  readonly table: string;
  readonly action: string;
  readonly fields: readonly UnloadField[];
}

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");

function renderValue(value: string): string {
  if (!/[<>&]/.test(value)) {
    return value;
  }
  return value.includes("]]>") ? escapeText(value) : `<![CDATA[${value}]]>`;
}

function renderField(field: UnloadField): string {
  const attribute =
    field.display === undefined ? "" : ` display_value="${escapeAttribute(field.display)}"`;
  return field.value === ""
    ? `<${field.name}${attribute}/>`
    : `<${field.name}${attribute}>${renderValue(field.value)}</${field.name}>`;
}

function renderRecord(record: UnloadRecord): string {
  const fields = [...record.fields].sort((a, b) => (a.name < b.name ? -1 : 1)).map(renderField);
  return [`<${record.table} action="${record.action}">`, ...fields, `</${record.table}>`].join(
    "\n",
  );
}

export function renderUnload(unloadDate: string, records: readonly UnloadRecord[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<unload unload_date="${unloadDate}">`,
    ...records.map(renderRecord),
    "</unload>",
    "",
  ].join("\n");
}
