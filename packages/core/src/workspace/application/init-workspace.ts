import {
  DirectoryNotEmptyError,
  NestedRepositoryError,
  WorkspaceExistsError,
} from "../domain/errors";
import { manifestFor, type WorkspaceManifest } from "../domain/manifest";
import type { WorkspaceStore } from "../ports";

export async function initWorkspace(
  directory: string,
  createdWith: string,
  store: WorkspaceStore,
): Promise<WorkspaceManifest> {
  if ((await store.readManifest(directory)) !== null) {
    throw new WorkspaceExistsError(directory);
  }
  if (await store.isInsideGitRepository(directory)) {
    throw new NestedRepositoryError(directory);
  }
  if (!(await store.isEmptyOrMissing(directory))) {
    throw new DirectoryNotEmptyError(directory);
  }
  const manifest = manifestFor(createdWith);
  await store.create(directory, manifest);
  return manifest;
}
