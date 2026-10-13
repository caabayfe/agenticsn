import type { ElevatedSession, PushJournal, SwitchedPreference } from "../ports";
import { type InstanceSession, restorePreference, switchPreference } from "./push-steps";

// Makes `value` the user's preference `name`, journaled so it is restored even after a crash.
// The platform creates a record in the user's current application (apps.current_app),
// whatever sys_scope it is sent, and records it in that application's current update set
// (ADR-0025).
export async function switchFor(
  session: InstanceSession,
  preference: { readonly user: string; readonly name: string; readonly value: string },
  journal: { current: PushJournal },
  save: (preferences: readonly SwitchedPreference[]) => Promise<void>,
): Promise<void> {
  const { user, name, value } = preference;
  const switched = await switchPreference(session, user, name, value);
  await save([...journal.current.preferences, switched]);
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
