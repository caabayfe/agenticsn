import { rm } from "node:fs/promises";
import { runGit } from "../../src/adapters/git/run-git";

// Removes a test's temporary folder holding git workspaces. A workspace turns on core.fsmonitor
// on macOS and Windows, and the daemon git starts for it can still hold the folder (EBUSY on the
// Windows runner, "bad object" on macOS, as in git-integrator.test.ts): stop it in each
// workspace first, then retry a removal that Windows refuses while a handle is closing.
export async function removeTestTree(base: string, workspaces: readonly string[]): Promise<void> {
  await Promise.all(
    workspaces.map((root) => runGit(["fsmonitor--daemon", "stop"], root).catch(() => undefined)),
  );
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
