import {
  DirectoryNotEmptyError,
  NestedRepositoryError,
  WorkspaceExistsError,
} from "../domain/errors";
import { manifestFor, type WorkspaceManifest } from "../domain/manifest";
import type { WorkspaceStore } from "../ports";

// `scaffold` writes the workspace's first files (the global Fluent project, ADR-0031) once the
// directory is known to be usable, so the first commit holds them.
export async function initWorkspace(
  directory: string,
  createdWith: string,
  store: WorkspaceStore,
  scaffold: () => Promise<unknown> = async () => {},
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
  await scaffold();
  await store.create(directory, manifest);
  return manifest;
}
