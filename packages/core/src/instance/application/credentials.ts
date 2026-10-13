import type { InstanceReader } from "../../connection/ports";
import { InvalidInputError } from "../../kernel/errors";
import { CredentialsMissingError, ProfileNotTrustedError } from "../domain/errors";
import { credentialVariables, type InstanceProfile, secretName } from "../domain/profile";
import { trustProblems, untrustedHint } from "../domain/trust";
import type { CredentialStore } from "../ports";
import {
  verifyCanElevate,
  verifyCredentialMatchesKind,
  verifySessionIdentity,
} from "./verify-access";

// ADR-0020: logging in is how a person trusts a profile's url and kind. The reader uses the
// typed secret; nothing is stored unless the instance accepts it and it matches the kind.
export async function login(
  profile: InstanceProfile,
  secret: string,
  store: CredentialStore,
  reader: InstanceReader,
  signal: AbortSignal,
  options: { readonly allowElevation?: boolean } = {},
): Promise<void> {
  if (secret === "") {
    throw new InvalidInputError(`the ${secretName(profile)} must not be empty`);
  }
  const elevation = options.allowElevation === true;
  await verifySessionIdentity(profile, reader, signal);
  await verifyCredentialMatchesKind(profile, reader, signal);
  if (elevation) {
    await verifyCanElevate(profile, reader, signal);
  }
  await store.write(profile, secret, { elevation });
}

export async function logout(profile: InstanceProfile, store: CredentialStore): Promise<boolean> {
  return store.remove(profile);
}

export async function resolveSecret(
  profile: InstanceProfile,
  store: CredentialStore,
): Promise<string> {
  return (await resolveAccess(profile, store)).secret;
}

// The trusted secret, and whether a person opted this instance into elevated writes (ADR-0024).
// The opt-in is read from the same item as the secret, so editing the workspace cannot set it.
export async function resolveAccess(
  profile: InstanceProfile,
  store: CredentialStore,
): Promise<{ readonly secret: string; readonly elevation: boolean }> {
  const credential = await store.read(profile);
  if (credential === null || credential.secret === "") {
    throw new CredentialsMissingError(profile.name, credentialVariables(profile));
  }
  const problems = trustProblems(profile, credential.trusted);
  if (problems.length > 0) {
    throw new ProfileNotTrustedError(
      profile.name,
      problems,
      untrustedHint(profile, credential.source),
    );
  }
  const elevation =
    credential.trusted?.elevation === true &&
    profile.kind === "development" &&
    profile.auth.method === "basic";
  return { secret: credential.secret, elevation };
}
