import { WorkspaceNotFoundError } from "../domain/errors";
import { checkLayout, type WorkspaceManifest } from "../domain/manifest";
import type { WorkspaceStore } from "../ports";

export interface LocatedWorkspace {
  readonly root: string;
  readonly manifest: WorkspaceManifest;
}

// Walks up from `start` to the nearest workspace, the way git finds `.git`.
export async function locateWorkspace(
  start: string,
  store: WorkspaceStore,
): Promise<LocatedWorkspace> {
  for (const directory of store.ancestorsOf(start)) {
    const manifest = await store.readManifest(directory);
    if (manifest !== null) {
      return { root: directory, manifest: checkLayout(manifest) };
    }
  }
  throw new WorkspaceNotFoundError(start);
}
