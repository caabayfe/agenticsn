import { sha256Hex } from "../../kernel/sha256";
import { DocumentationSourceError } from "./errors";
import { fieldsOf, isFields, textOf as text } from "./fields";

// One fact a page rests on: a mirror record, optionally one of its fields, and the hash the
// author verified the claim against (ADR-0034).
export interface Evidence {
  readonly id: string;
  readonly table: string;
  readonly sysId: string;
  readonly field?: string;
  readonly hash?: string;
  readonly how: string;
  readonly result: string;
}

export type EvidenceStatus = "fresh" | "changed" | "missing" | "unpinned";

const EVIDENCE_ID = /^E\d+$/;
const RECORD = /^([a-z][a-z0-9_]*)\/([A-Za-z0-9_]{1,64})$/;
const FIELD = /^[a-z][a-z0-9_]*$/;

function oneEvidence(path: string, id: string, raw: unknown): Evidence {
  if (!EVIDENCE_ID.test(id)) {
    throw new DocumentationSourceError(path, `evidence id ${id} must be E followed by digits`);
  }
  const item = fieldsOf(raw);
  const match = RECORD.exec(text(item["record"]) ?? "");
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new DocumentationSourceError(path, `evidence ${id}: record must be <table>/<sys_id>`);
  }
  const field = text(item["field"]);
  if (field !== undefined && !FIELD.test(field)) {
    throw new DocumentationSourceError(path, `evidence ${id}: field ${field} is not a field name`);
  }
  const hash = text(item["hash"]);
  return {
    id,
    table: match[1],
    sysId: match[2],
    ...(field === undefined ? {} : { field }),
    ...(hash === undefined ? {} : { hash }),
    how: text(item["how"]) ?? "",
    result: text(item["result"]) ?? "",
  };
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
export function evidenceStatus(evidence: Evidence, current: string | null): EvidenceStatus {
  if (current === null) {
    return "missing";
  }
  if (evidence.hash === undefined) {
    return "unpinned";
  }
  return evidence.hash === current ? "fresh" : "changed";
}

export function anchorOf(evidence: Evidence): string {
  const record = `${evidence.table}/${evidence.sysId}`;
  return evidence.field === undefined ? record : `${record}#${evidence.field}`;
}

// A record as the mirror holds it: its content hash, and its fields with long fields read from
// their own files.
export interface MirrorRecord {
  readonly hash: string;
  readonly fields: Readonly<Record<string, string>>;
}

// The hash a piece of evidence is compared with: the record's, or the SHA-256 of one field's
// text. Null when the record, or that field, is gone.
export function anchorHash(evidence: Evidence, record: MirrorRecord | null): string | null {
  if (record === null) {
    return null;
  }
  if (evidence.field === undefined) {
    return record.hash;
  }
  const value = record.fields[evidence.field];
  return value === undefined ? null : sha256Hex(value);
}
