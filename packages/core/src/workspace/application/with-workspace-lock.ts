import { WorkspaceLockedError } from "../domain/errors";
import type { WorkspaceLock } from "../ports";

// Runs `work` holding the instance's workspace lock (instance null: the workspace's own lock);
// a second command fails fast, naming the one that holds it (REL-03).
export async function withWorkspaceLock<T>(
  lock: WorkspaceLock,
  claim: {
    readonly instance: string | null;
    readonly command: string;
    readonly started: string;
  },
  work: () => Promise<T>,
): Promise<T> {
  const taken = await lock.acquire(claim.command, claim.started);
  if (!taken.acquired) {
    throw new WorkspaceLockedError(claim.instance, taken.holder);
  }
  try {
    return await work();
  } finally {
    await lock.release();
  }
}
