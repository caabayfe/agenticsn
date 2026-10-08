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
// compared, as the instance's copy never holds them.
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
  return (
    same &&
    Object.entries(mine.fields).every(
      ([field, value]) => withheld.has(field.toLowerCase()) || theirs.fields[field] === value,
    )
  );
}
