import { canonicalText } from "../../kernel/canonical-text";
import { HASH_EXCLUDED_FIELDS } from "../../kernel/record-hash";
import { platformWritten } from "../../metadata/domain/field-rules";
import { parseRecord } from "../../metadata/domain/record-layout";

// A record's YAML document and its field files (scripts, HTML), as read from git.
export interface RecordCopy {
  readonly document: unknown;
  readonly files: readonly { readonly field: string; readonly content: string }[];
}

// A record created in the workspace and pushed comes back on the next pull with the fields the
// platform fills in (defaults, api_name, provenance). The instance's copy confirms the local one
// when it is the same record and holds every field set locally with the same value, scripts
// included: taking it loses nothing. Fields pull withholds (a property's value) are not
// compared, as the instance's copy never holds them; nor are fields the platform rewrites on
// save, as the local value can never come back.
export function instanceConfirms(local: RecordCopy, remote: RecordCopy): boolean {
  let mine: ReturnType<typeof parseRecord>["artifact"];
  let theirs: ReturnType<typeof parseRecord>["artifact"];
  try {
    mine = parseRecord(local.document, local.files).artifact;
    theirs = parseRecord(remote.document, remote.files).artifact;
  } catch {
    return false;
  }
  const same =
    mine.identity.sysId === theirs.identity.sysId &&
    mine.identity.className === theirs.identity.className &&
    mine.identity.scope === theirs.identity.scope;
  const withheld = new Set(theirs.redacted.map((field) => field.toLowerCase()));
  const ignored = (field: string) =>
    withheld.has(field.toLowerCase()) || platformWritten(theirs.identity.className, field);
  return (
    same &&
    Object.entries(mine.fields).every(
      ([field, value]) => ignored(field) || theirs.fields[field] === value,
    )
  );
}

type Rows = readonly Readonly<Record<string, unknown>>[];

function rowsOf(document: unknown): Rows | null {
  if (!Array.isArray(document)) {
    return null;
  }
  const rows: Readonly<Record<string, unknown>>[] = [];
  for (const row of document) {
    if (typeof row !== "object" || row === null) {
      return null;
    }
    rows.push(Object.fromEntries(Object.entries(row)));
  }
  return rows;
}

const text = (value: unknown) =>
  canonicalText(value === null || value === undefined ? "" : String(value));

// A child-row file pushed from here comes back with the platform's provenance on each row
// (ADR-0025). The instance's rows confirm the local ones when every local row is there, by
// sys_id, with each of its content fields unchanged.
export function instanceConfirmsRows(local: unknown, remote: unknown): boolean {
  const mine = rowsOf(local);
  const theirs = rowsOf(remote);
  if (mine === null || theirs === null) {
    return false;
  }
  const byId = new Map(theirs.map((row) => [text(row["sys_id"]), row]));
  return mine.every((row) => {
    const match = byId.get(text(row["sys_id"]));
    return (
      match !== undefined &&
      Object.entries(row).every(
        ([field, value]) => HASH_EXCLUDED_FIELDS.has(field) || text(match[field]) === text(value),
      )
    );
  });
}
