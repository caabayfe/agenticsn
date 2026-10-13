import type { ElevatedSession, PushJournal, SwitchedPreference } from "../ports";
import { type InstanceSession, restorePreference, switchPreference } from "./push-steps";

// Makes the scope's update set and application current for the user: the platform records a
// write in the current update set of the record's scope, and creates a record in the user's
// current application, whatever sys_scope it is sent (ADR-0025).
export async function switchTo(
  session: InstanceSession,
  scope: { id: string; setId: string; user: string },
  save: (preferences: readonly SwitchedPreference[]) => Promise<void>,
) {
  const switched: SwitchedPreference[] = [];
  const updateSet = scope.id === "global" ? "sys_update_set" : `updateSetForScope${scope.id}`;
  for (const [name, value] of [
    [updateSet, scope.setId],
    ["apps.current_app", scope.id],
  ] as const) {
    switched.push(await switchPreference(session, scope.user, name, value));
    await save(switched);
  }
}

// Closes the elevated session and restores each preference, trying all of them. What is
// restored leaves the journal; what is not stays there for the next push to restore.
export async function settle(
  session: InstanceSession,
  elevated: ElevatedSession | null,
  journal: { current: PushJournal },
  save: (preferences: readonly SwitchedPreference[]) => Promise<void>,
): Promise<void> {
  const failures: unknown[] = [];
  await elevated?.close().catch((error: unknown) => failures.push(error));
  for (const preference of [...journal.current.preferences].reverse()) {
    try {
      await restorePreference(session, preference);
      await save(journal.current.preferences.filter((p) => p !== preference));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}
