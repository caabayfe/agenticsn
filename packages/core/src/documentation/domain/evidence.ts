import { sha256Hex } from "../../kernel/sha256";
import { DocumentationSourceError } from "./errors";
import { fieldsOf, isFields, textOf as text } from "./fields";

interface EvidenceBase {
  readonly id: string;
  readonly how: string;
  readonly result: string;
}

// A fact a page rests on, anchored to a mirror record: the record, one of its fields, or its
// children (a form section's fields, a choice set's choices), and the hash the author verified
// the claim against (ADR-0036).
export interface RecordEvidence extends EvidenceBase {
  readonly kind: "record";
  readonly table: string;
  readonly sysId: string;
  readonly field?: string;
  readonly children?: string;
  readonly hash?: string;
}

// A fact a person checked on a screen the mirror can't prove (a label drawn by a widget's
// script, a phone procedure): who, when and where (spec 010a, decision 3).
export interface SeenEvidence extends EvidenceBase {
  readonly kind: "seen";
  readonly by: string;
  // YYYY-MM-DD.
  readonly on: string;
  readonly where: string;
}

// A fact someone decided: the answer to one of the documentation's questions (ADR-0041),
// cited as Q03, or on-call/Q03 from another process.
export interface AnsweredEvidence extends EvidenceBase {
  readonly kind: "answered";
  readonly question: string;
}

export type Evidence = RecordEvidence | SeenEvidence | AnsweredEvidence;

export type EvidenceStatus =
  | "fresh"
  | "changed"
  | "missing"
  | "unpinned"
  | "seen"
  | "recheck"
  | "answered";

// Seen evidence asks to be checked again after this many days.
export const SEEN_RECHECK_DAYS = 90;

const EVIDENCE_ID = /^E\d+$/;
const RECORD = /^([a-z][a-z0-9_]*)\/([A-Za-z0-9_]{1,64})$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUESTION = /^(?:[a-z][a-z0-9-]*\/)?Q\d+$/;

function dateText(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString().slice(0, 10) : text(value);
}

function seenEvidence(path: string, base: EvidenceBase, raw: unknown): SeenEvidence {
  const seen = fieldsOf(raw);
  const by = text(seen["by"]);
  const on = dateText(seen["on"]);
  const where = text(seen["where"]);
  if (by === undefined || on === undefined || !DATE.test(on) || where === undefined) {
    throw new DocumentationSourceError(
      path,
      `evidence ${base.id}: seen needs by, on (YYYY-MM-DD) and where`,
    );
  }
  return { kind: "seen", ...base, by, on, where };
}

function name(path: string, id: string, raw: unknown, what: string): string | undefined {
  const value = text(raw);
  if (value !== undefined && !NAME.test(value)) {
    throw new DocumentationSourceError(path, `evidence ${id}: ${what} ${value} is not a name`);
  }
  return value;
}

function recordEvidence(
  path: string,
  base: EvidenceBase,
  item: Record<string, unknown>,
): RecordEvidence {
  const match = RECORD.exec(text(item["record"]) ?? "");
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new DocumentationSourceError(
      path,
      `evidence ${base.id}: record must be <table>/<sys_id>, or the evidence must be seen`,
    );
  }
  const field = name(path, base.id, item["field"], "field");
  const children = name(path, base.id, item["children"], "children table");
  if (field !== undefined && children !== undefined) {
    throw new DocumentationSourceError(path, `evidence ${base.id}: anchor a field or children`);
  }
  const hash = text(item["hash"]);
  return {
    kind: "record",
    ...base,
    table: match[1],
    sysId: match[2],
    ...(field === undefined ? {} : { field }),
    ...(children === undefined ? {} : { children }),
    ...(hash === undefined ? {} : { hash }),
  };
}

// A record anchor outside a page, such as what a question is about; `id` names it in errors.
export function parseAnchor(path: string, id: string, raw: unknown): RecordEvidence {
  return recordEvidence(path, { id, how: "", result: "" }, fieldsOf(raw));
}

function answeredEvidence(path: string, base: EvidenceBase, raw: unknown): AnsweredEvidence {
  const question = text(raw);
  if (question === undefined || !QUESTION.test(question)) {
    throw new DocumentationSourceError(
      path,
      `evidence ${base.id}: answered names a question, Q03 or <process>/Q03`,
    );
  }
  return { kind: "answered", ...base, question };
}

function oneEvidence(path: string, id: string, raw: unknown): Evidence {
  if (!EVIDENCE_ID.test(id)) {
    throw new DocumentationSourceError(path, `evidence id ${id} must be E followed by digits`);
  }
  const item = fieldsOf(raw);
  const base = { id, how: text(item["how"]) ?? "", result: text(item["result"]) ?? "" };
  if (item["answered"] !== undefined) return answeredEvidence(path, base, item["answered"]);
  return item["seen"] === undefined
    ? recordEvidence(path, base, item)
    : seenEvidence(path, base, item["seen"]);
}

export function parseEvidence(path: string, raw: unknown): readonly Evidence[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!isFields(raw)) {
    throw new DocumentationSourceError(path, "evidence must be a map of E01, E02, …");
  }
  return Object.entries(raw).map(([id, item]) => oneEvidence(path, id, item));
}

// `current` is the mirror's hash of what the evidence anchors, or null when it is gone.
export function evidenceStatus(evidence: RecordEvidence, current: string | null): EvidenceStatus {
  if (current === null) {
    return "missing";
  }
  if (evidence.hash === undefined) {
    return "unpinned";
  }
  return evidence.hash === current ? "fresh" : "changed";
}

// `today` is YYYY-MM-DD.
export function seenStatus(evidence: SeenEvidence, today: string): EvidenceStatus {
  const days = (Date.parse(today) - Date.parse(evidence.on)) / 86_400_000;
  return days > SEEN_RECHECK_DAYS ? "recheck" : "seen";
}

export function anchorOf(evidence: Evidence): string {
  if (evidence.kind === "seen") {
    return `seen by ${evidence.by} on ${evidence.on}: ${evidence.where}`;
  }
  if (evidence.kind === "answered") {
    return `answer to ${evidence.question}`;
  }
  const record = `${evidence.table}/${evidence.sysId}`;
  if (evidence.children !== undefined) {
    return `${record}#children.${evidence.children}`;
  }
  return evidence.field === undefined ? record : `${record}#${evidence.field}`;
}

// A record as the mirror holds it: its content hash, its fields with long fields read from
// their own files, and the text of its children files by child table.
export interface MirrorRecord {
  readonly hash: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly children?: Readonly<Record<string, string>>;
}

// The hash a piece of evidence is compared with: the record's, or the SHA-256 of one field's
// or one children file's text. Null when the record, or that part, is gone.
export function anchorHash(evidence: RecordEvidence, record: MirrorRecord | null): string | null {
  if (record === null) {
    return null;
  }
  if (evidence.children !== undefined) {
    const children = record.children?.[evidence.children];
    return children === undefined ? null : sha256Hex(children);
  }
  if (evidence.field === undefined) {
    return record.hash;
  }
  const value = record.fields[evidence.field];
  return value === undefined ? null : sha256Hex(value);
}
