import { gunzipSync } from "node:zlib";
import {
  type BuiltUnit,
  type UnitAction,
  type UnitRecord,
  UnreadableBuildError,
  unitSpec,
} from "@snagentic/core";
import { XMLParser } from "fast-xml-parser";

// Reads a built update file (dist/app/<update name>.xml) as a unit (ADR-0033 item 1). A file
// holds either one record under <record_update table="...">, or a composite: a wrapper element
// (a list, a section, a form's sections, a choice set) around the records it replaces whole.

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

const ATTRIBUTES = ":@";
const tagOf = (node: Node) => Object.keys(node).find((key) => key !== ATTRIBUTES) ?? "";
const childrenOf = (node: Node): Node[] => {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? value.filter((v): v is Node => typeof v === "object") : [];
};
const attributesOf = (node: Node): Record<string, string> => {
  const value = node[ATTRIBUTES];
  return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
};

function textOf(node: Node): string {
  return childrenOf(node)
    .map((part) => {
      const tag = tagOf(part);
      if (tag === "#text") return String(part["#text"] ?? "");
      if (tag === "#cdata")
        return childrenOf(part)
          .map((c) => String(c["#text"] ?? ""))
          .join("");
      return "";
    })
    .join("");
}

// Flow payloads are gzipped JSON, compressed differently by each build: compared opened.
function opened(value: string): string {
  if (!value.startsWith("H4sI")) return value;
  try {
    return gunzipSync(Buffer.from(value, "base64")).toString("utf8");
  } catch {
    return value;
  }
}

const isRecord = (node: Node) =>
  attributesOf(node)["action"] !== undefined && tagOf(node) !== "#text";

function recordOf(node: Node): UnitRecord {
  const fields: Record<string, string> = {};
  const referenceNames: Record<string, string> = {};
  for (const child of childrenOf(node)) {
    const tag = tagOf(child);
    if (tag.startsWith("#") || isRecord(child)) continue;
    fields[tag] = opened(textOf(child));
    const name = attributesOf(child)["name"];
    if (name !== undefined) referenceNames[tag] = name;
  }
  const action: UnitAction =
    attributesOf(node)["action"] === "DELETE" ? "DELETE" : "INSERT_OR_UPDATE";
  return { table: tagOf(node), sysId: fields["sys_id"] ?? "", action, fields, referenceNames };
}

// The records of a file: those under <record_update>, and those one level inside a wrapper.
function recordsIn(root: Node): UnitRecord[] {
  const records: UnitRecord[] = [];
  for (const node of childrenOf(root)) {
    if (tagOf(node).startsWith("#")) continue;
    const inner = childrenOf(node).filter(isRecord);
    if (inner.length > 0) records.push(...inner.map(recordOf));
    else if (isRecord(node)) records.push(recordOf(node));
  }
  return records;
}

// The record a unit is named after: the table <record_update> names, or the composite's owner
// (the record whose rows the others are), or the only record.
function headOf(records: readonly UnitRecord[], table: string | undefined): UnitRecord | undefined {
  return (
    records.find((r) => r.table === table) ??
    records.find((r) => {
      const children = unitSpec(r.table).children;
      return children !== undefined && records.every((o) => o === r || o.table === children.table);
    }) ??
    (records.length === 1 ? records[0] : undefined)
  );
}

export function builtUnitOf(file: string, xml: string): BuiltUnit {
  const document = parser.parse(xml) as Node[];
  const root = document.find((node) => tagOf(node) === "record_update");
  if (root === undefined) throw new UnreadableBuildError(file, "it is not an update record");
  const records = recordsIn(root);
  const head = headOf(records, attributesOf(root)["table"]);
  if (head === undefined) throw new UnreadableBuildError(file, "no record names the unit");
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.xml$/, "");
  return { updateName: name, file, head, children: records.filter((r) => r !== head) };
}
