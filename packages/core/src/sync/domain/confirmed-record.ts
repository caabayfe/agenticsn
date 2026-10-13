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
