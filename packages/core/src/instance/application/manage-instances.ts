import type { InstanceName } from "../../kernel/instance-name";
import {
  InstanceExistsError,
  InstanceNotFoundError,
  InstanceUrlExistsError,
} from "../domain/errors";
import type { InstanceProfile } from "../domain/profile";
import type { ProfileStore } from "../ports";

export async function addInstance(
  root: string,
  profile: InstanceProfile,
  store: ProfileStore,
): Promise<void> {
  const existing = await store.list(root);
  if (existing.some((candidate) => candidate.name === profile.name)) {
    throw new InstanceExistsError(profile.name);
  }
  const sameUrl = existing.find((candidate) => candidate.url === profile.url);
  if (sameUrl !== undefined) {
    throw new InstanceUrlExistsError(profile.url, sameUrl.name);
  }
  await store.write(root, profile);
}

export async function listInstances(root: string, store: ProfileStore): Promise<InstanceProfile[]> {
  return [...(await store.list(root))].sort((left, right) => left.name.localeCompare(right.name));
}

export async function getInstance(
  root: string,
  name: InstanceName,
  store: ProfileStore,
): Promise<InstanceProfile> {
  const profile = await store.read(root, name);
  if (profile === null) {
    throw new InstanceNotFoundError(name);
  }
  return profile;
}

export async function removeInstance(
  root: string,
  name: InstanceName,
  store: ProfileStore,
): Promise<void> {
  await getInstance(root, name, store);
  await store.remove(root, name);
}
