import { needsElevation, type PlannedWrite } from "../domain/change";
import { ElevatedUserMismatchError, ElevationUnavailableError } from "../domain/errors";
import type { ElevatedSession, ElevatedSessions } from "../ports";

// ADR-0024: a plan that writes ACLs needs a way to open an elevated session, checked before
// anything is written.
export function ensureElevationAvailable(
  sessions: ElevatedSessions | null,
  writes: readonly PlannedWrite[],
): void {
  if (sessions === null && writes.some((write) => needsElevation(write.table))) {
    throw new ElevationUnavailableError();
  }
}

// The elevated session a scope's writes need, or null when none of them needs one. Opened at
// the start of the scope, so a failed sign-in or a wrong user leaves nothing written.
export async function elevatedSessionFor(
  sessions: ElevatedSessions | null,
  writes: readonly PlannedWrite[],
  username: string,
  signal: AbortSignal,
): Promise<ElevatedSession | null> {
  ensureElevationAvailable(sessions, writes);
  if (sessions === null || !writes.some((write) => needsElevation(write.table))) {
    return null;
  }
  const session = await sessions.open(signal);
  if (session.username !== username) {
    await session.close();
    throw new ElevatedUserMismatchError(username, session.username);
  }
  return session;
}
