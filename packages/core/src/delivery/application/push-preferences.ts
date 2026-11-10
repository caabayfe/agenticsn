import type { PushJournal, SwitchedPreference } from "../ports";
import {
  applyPreference,
  currentPreference,
  type InstanceSession,
  restorePreference,
  restoring,
} from "./push-steps";

// Makes `value` the user's preference `name`, journaled so it is restored even after a crash:
// the value to restore is journaled before the instance changes, never after (REL-03).
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
  const earlier = journal.current.preferences;
  const current = await currentPreference(session, user, name);
  await save([...earlier, current]);
  const switched = await applyPreference(session, current, value);
  // A preference the user did not have is journaled again with the row the switch created.
  if (switched.sysId !== current.sysId) {
    await save([...earlier, switched]);
  }
}

// Restores each preference, trying all of them. What is restored leaves the journal; what is
// not stays there for the next push to restore. It runs even when the push was cancelled.
export async function settle(
  session: InstanceSession,
  journal: { current: PushJournal },
  save: (preferences: readonly SwitchedPreference[]) => Promise<void>,
): Promise<void> {
  const cleanup = restoring(session);
  const failures: unknown[] = [];
  for (const preference of [...journal.current.preferences].reverse()) {
    try {
      await restorePreference(cleanup, preference);
      await save(journal.current.preferences.filter((p) => p !== preference));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}
