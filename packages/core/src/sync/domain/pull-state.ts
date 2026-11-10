// Relative to instances/<name>/: every pull commit carries the state and catalog it was pulled
// with, so any clone continues from git (ADR-0052 item 1).
export const PULL_FOLDER = "pull";
export const PULL_STATE_FILE = `${PULL_FOLDER}/state.yaml`;
export const PULL_CATALOG_FILE = `${PULL_FOLDER}/catalog.yaml`;

export interface Puller {
  // The instance user the pull signs in as.
  readonly user: string;
  readonly version: string;
}

interface Signed {
  readonly pulledBy?: string;
  readonly snagenticVersion?: string;
}

// The state a pull commit carries. A full pull's listings are this user's, so it names them; an
// incremental pull keeps the user its mirror was listed by (ADR-0052 item 4).
export function signedState<T extends Signed>(
  next: T,
  run: { readonly full: boolean; readonly puller: Puller },
): T {
  const pulledBy = run.full ? run.puller.user : (next.pulledBy ?? run.puller.user);
  return { ...next, pulledBy, snagenticVersion: run.puller.version };
}
