import {
  checkedUsername,
  usernameSource,
  usernameVariable,
  withUsername,
} from "../domain/identity";
import type { InstanceProfile } from "../domain/profile";
import type { IdentityStore, ProfileStore, UsernameSources } from "../ports";

// ADR-0054 item 1: SNAGENTIC_<NAME>_USERNAME, then this clone's identity, then instance.yaml.
export async function resolveUsername(
  root: string,
  profile: InstanceProfile,
  sources: UsernameSources,
): Promise<InstanceProfile> {
  if (profile.auth.method !== "basic") {
    return profile;
  }
  const variable = usernameVariable(profile);
  const fromEnvironment = sources.environment[variable] ?? "";
  if (fromEnvironment.trim() !== "") {
    return withUsername(profile, checkedUsername(fromEnvironment, variable), "environment");
  }
  const fromClone = await sources.clone.read(root, profile);
  return fromClone === null ? profile : withUsername(profile, fromClone, "clone");
}

// Every profile read through it carries the resolved username, so the keychain account, the
// identity check, push attribution and the user a pull records all use the same one.
export function usernameResolvingProfiles(
  store: ProfileStore,
  sources: UsernameSources,
): ProfileStore {
  return {
    list: async (root) =>
      Promise.all(
        (await store.list(root)).map((profile) => resolveUsername(root, profile, sources)),
      ),
    read: async (root, name) => {
      const profile = await store.read(root, name);
      return profile === null ? null : resolveUsername(root, profile, sources);
    },
    // Only new profiles are written (instance add), never one read through this store.
    write: (root, profile) => store.write(root, profile),
    remove: (root, name) => store.remove(root, name),
  };
}

// After a login: a username from this clone is stored as its identity, so the next command signs
// in as the same user. Returns whether it stored one.
export async function rememberIdentity(
  root: string,
  profile: InstanceProfile,
  identities: IdentityStore,
): Promise<boolean> {
  if (usernameSource(profile) !== "clone") {
    return false;
  }
  await identities.write(root, profile, profile.auth.username);
  return true;
}
