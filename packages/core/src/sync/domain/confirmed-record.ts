import { parseRecord } from "../../metadata/domain/record-layout";

// A record created in the workspace and pushed comes back on the next pull with the fields the
// platform fills in (defaults, api_name, provenance). Both sides then added the same file, which
// git reports as a conflict. The instance's copy confirms the local one when it is the same
// record and holds every field set locally with the same value: taking it loses nothing.
export function instanceConfirms(local: unknown, remote: unknown): boolean {
  let mine: ReturnType<typeof parseRecord>["artifact"];
  let theirs: ReturnType<typeof parseRecord>["artifact"];
  try {
    mine = parseRecord(local, []).artifact;
    theirs = parseRecord(remote, []).artifact;
  } catch {
    return false;
  }
  const same =
    mine.identity.sysId === theirs.identity.sysId &&
    mine.identity.className === theirs.identity.className &&
    mine.identity.scope === theirs.identity.scope;
  return (
    same && Object.entries(mine.fields).every(([field, value]) => theirs.fields[field] === value)
  );
}
