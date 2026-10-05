import { InvalidInputError } from "../../kernel/errors";
import { CredentialsMissingError } from "../domain/errors";
import { credentialVariable, type InstanceProfile } from "../domain/profile";
import type { CredentialStore } from "../ports";

export async function login(
  profile: InstanceProfile,
  secret: string,
  store: CredentialStore,
): Promise<void> {
  if (secret === "") {
    throw new InvalidInputError("the password must not be empty");
  }
  await store.write(profile, secret);
}

export async function logout(profile: InstanceProfile, store: CredentialStore): Promise<boolean> {
  return store.remove(profile);
}

export async function resolveSecret(
  profile: InstanceProfile,
  store: CredentialStore,
): Promise<string> {
  const secret = await store.read(profile);
  if (secret === null || secret === "") {
    throw new CredentialsMissingError(profile.name, credentialVariable(profile));
  }
  return secret;
}
