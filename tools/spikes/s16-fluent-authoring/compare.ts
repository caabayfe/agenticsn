// Spike S16 (F1): compare the records a Fluent build produces with the mirror, field by field.
// Not product code.
//   bun compare.ts <metadata dir> <scope> <built dir (dist/app)> [--verbose]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "../../../node_modules/.bun/fast-xml-parser@5.7.2/node_modules/fast-xml-parser";
import { mirrorRecords } from "./mirror-xml";

type Fields = Record<string, string>;
export interface BuiltRecord {
  readonly table: string;
  readonly sysId: string;
  readonly action: string;
  readonly fields: Fields;
}

// Platform-managed or provenance fields: never authored, so never compared.
const IGNORED = new Set([
  "sys_id",
  "sys_scope",
  "sys_package",
  "sys_update_name",
  "sys_class_name",
  "sys_created_by",
  "sys_created_on",
  "sys_updated_by",
  "sys_updated_on",
  "sys_mod_count",
  "sys_domain_path",
  "sys_name",
  "sys_tags",
  "sys_policy",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  preserveOrder: true,
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: false,
  parseTagValue: false,
});

type Node = Record<string, unknown>;
const tagOf = (node: Node) => Object.keys(node).find((k) => k !== ":@") ?? "";
const childrenOf = (node: Node): Node[] => {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? (value as Node[]) : [];
};
function textOf(node: Node): string | null {
  const kids = childrenOf(node);
  if (kids.some((k) => childrenOf(k).length > 0 && !["#text", "#cdata"].includes(tagOf(k)))) {
    return null;
  }
  return kids
    .map((k) => {
      const tag = tagOf(k);
      if (tag === "#text") return String(k["#text"] ?? "");
      if (tag === "#cdata")
        return childrenOf(k)
          .map((c) => String(c["#text"] ?? ""))
          .join("");
      return "";
    })
    .join("");
}

// Every element that carries a sys_id child is a record of the table its tag names.
function collect(node: Node, out: BuiltRecord[]) {
  const kids = childrenOf(node);
  const sysId = kids.find((k) => tagOf(k) === "sys_id");
  const attrs = (node[":@"] ?? {}) as Record<string, string>;
  if (sysId !== undefined) {
    const fields: Fields = {};
    for (const kid of kids) {
      const value = textOf(kid);
      if (value !== null) fields[tagOf(kid)] = value;
    }
    out.push({
      table: tagOf(node),
      sysId: textOf(sysId) ?? "",
      action: attrs["@action"] ?? "",
      fields,
    });
  }
  for (const kid of kids) collect(kid, out);
}

export function builtRecords(dir: string): BuiltRecord[] {
  const out: BuiltRecord[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".xml"))) {
    for (const node of parser.parse(readFileSync(join(dir, name), "utf8")) as Node[]) {
      collect(node, out);
    }
  }
  return out;
}

const NATURAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  sys_dictionary: ["name", "element"],
  sys_choice: ["name", "element", "value", "language"],
  sys_ui_element: ["sys_ui_section", "element", "position"],
  sys_documentation: ["name", "element", "language"],
};

function naturalKey(table: string, fields: Fields): string | null {
  const keys = NATURAL_KEYS[table];
  return keys === undefined ? null : `${table}|${keys.map((k) => fields[k] ?? "").join("|")}`;
}

const norm = (v: string) => v.replace(/\r\n/g, "\n").replace(/\n+$/, "");

type Expected = Map<string, { table: string; fields: Fields }>;
type Diff = { key: string; field: string; mirror: string; built: string | undefined };

function expectedRecords(metadata: string, scope: string): Expected {
  const expected: Expected = new Map();
  for (const r of mirrorRecords(metadata, scope)) {
    if (r.table === "sys_app" || r.table === "sys_metadata_delete") continue;
    expected.set(r.sysId, { table: r.table, fields: r.fields });
    for (const [table, rows] of Object.entries(r.children)) {
      for (const row of rows) expected.set(row["sys_id"] ?? "", { table, fields: { ...row } });
    }
  }
  return expected;
}

// Child records the platform identifies by content, not sys_id: matched by that key when the
// build named them anew.
function finder(built: readonly BuiltRecord[]) {
  const byId = new Map(built.map((b) => [b.sysId, b]));
  const byKey = new Map<string, BuiltRecord>();
  for (const b of built) {
    const key = naturalKey(b.table, b.fields);
    if (key !== null) byKey.set(key, b);
  }
  return (sysId: string, table: string, fields: Fields) =>
    byId.get(sysId) ?? byKey.get(naturalKey(table, fields) ?? "");
}

function fieldDiffs(key: string, want: Fields, got: BuiltRecord): Diff[] {
  return Object.entries(want).flatMap(([field, value]) => {
    if (IGNORED.has(field)) return [];
    const builtValue = got.fields[field];
    // A field the build leaves out is not written: the same as the mirror only when empty.
    const same = builtValue === undefined ? value === "" : norm(builtValue) === norm(value);
    return same ? [] : [{ key, field, mirror: value, built: builtValue }];
  });
}

export function compare(metadata: string, scope: string, built: readonly BuiltRecord[]) {
  const expected = expectedRecords(metadata, scope);
  const lookup = finder(built);
  const missing: string[] = [];
  const diffs: Diff[] = [];
  const matched = new Set<string>();
  let equal = 0;
  for (const [sysId, want] of expected) {
    const got = lookup(sysId, want.table, want.fields);
    if (got === undefined) {
      missing.push(`${want.table}/${sysId}`);
      continue;
    }
    matched.add(got.sysId);
    const found = fieldDiffs(`${want.table}/${sysId}`, want.fields, got);
    diffs.push(...found);
    if (found.length === 0) equal++;
  }
  const extra = built.filter((b) => !matched.has(b.sysId)).map((b) => `${b.table}/${b.sysId}`);
  return { expected: expected.size, equal, missing, extra, diffs };
}

if (import.meta.main) {
  const [metadata = "", scope = "", dist = "", verbose] = process.argv.slice(2);
  const result = compare(metadata, scope, builtRecords(dist));
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`);
  };
  console.log(`mirror records ${result.expected}, identical ${result.equal}`);
  console.log(
    `missing from build ${result.missing.length}:`,
    count(result.missing.map((k) => k.split("/")[0] ?? "")),
  );
  console.log(
    `only in build ${result.extra.length}:`,
    count(result.extra.map((k) => k.split("/")[0] ?? "")),
  );
  console.log(`differing fields ${result.diffs.length}:`);
  for (const line of count(result.diffs.map((d) => `${d.key.split("/")[0]}.${d.field}`))) {
    console.log(`  ${line}`);
  }
  if (verbose) {
    for (const d of result.diffs) {
      console.log(
        `${d.key} ${d.field}: mirror ${JSON.stringify(d.mirror.slice(0, 80))} built ${JSON.stringify(d.built?.slice(0, 80))}`,
      );
    }
    console.log("missing:", result.missing.join(" "));
  }
}
