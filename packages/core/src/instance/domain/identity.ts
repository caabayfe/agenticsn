// ADR-0054: each developer signs in as themselves. The username comes from the environment, then
// this clone's identity, then instance.yaml; one resolved username is used everywhere.
import { InvalidInputError } from "../../kernel/errors";
import { IdentityMismatchError, type UsernameOrigin } from "./errors";
import {
  credentialVariable,
  type InstanceProfile,
  instanceHost,
  type UsernameSource,
  usernameProblem,
} from "./profile";

// Environment variable that names the user in CI, e.g. SNAGENTIC_ACME_PROD_USERNAME.
export function usernameVariable(profile: InstanceProfile): string {
  return credentialVariable(profile).replace(/_PASSWORD$/, "_USERNAME");
}

export function usernameSource(profile: InstanceProfile): UsernameSource {
  return profile.usernameSource ?? "profile";
}

const LABELS: Readonly<Record<UsernameSource, string>> = {
  environment: "environment",
  clone: "this clone",
  profile: "instance.yaml",
};

export function usernameSourceLabel(profile: InstanceProfile): string {
  return LABELS[usernameSource(profile)];
}

// "jdoe (this clone)": who a command acts as, and where that came from.
export function actingAs(profile: InstanceProfile): string {
  return `${profile.auth.username} (${usernameSourceLabel(profile)})`;
}

// The profile signing in as `username`. Only Basic authentication: an OAuth client's user is its
// Application User (ADR-0021).
export function withUsername(
  profile: InstanceProfile,
  username: string,
  source: Exclude<UsernameSource, "profile">,
): InstanceProfile {
  if (profile.auth.method !== "basic") {
    return profile;
  }
  return { ...profile, auth: { method: "basic", username }, usernameSource: source };
}

// A username from outside instance.yaml gets the same check as the file's.
export function checkedUsername(value: string, from: string): string {
  const username = value.trim();
  const problem = usernameProblem(username);
  if (problem !== null) {
    throw new InvalidInputError(`${from}: ${problem}`);
  }
  return username;
}

// Keychain account of this clone's identity: one per workspace root and instance, so another
// clone or another instance never picks it up.
export function identityAccount(root: string, profile: InstanceProfile): string {
  return `identity:${profile.name}@${instanceHost(profile)}:${root}`;
}

function usernameOrigin(profile: InstanceProfile, actual: string): UsernameOrigin {
  const login = `snagentic auth login ${profile.name} --username ${actual}`;
  switch (usernameSource(profile)) {
    case "environment":
      return {
        names: usernameVariable(profile),
        fix: `set ${usernameVariable(profile)} to ${actual} if that is the right user`,
      };
    case "clone":
      return {
        names: "this clone's identity",
        fix: `if ${actual} is the right user, run: ${login}`,
      };
    case "profile":
      return {
        names: `instances/${profile.name}/instance.yaml`,
        fix: `if ${actual} is you, run: ${login}; if it is the team's user, set the username in instances/${profile.name}/instance.yaml to ${actual}`,
      };
  }
}

export function identityMismatch(profile: InstanceProfile, actual: string): IdentityMismatchError {
  return new IdentityMismatchError(profile.auth.username, actual, usernameOrigin(profile, actual));
}

// ADR-0054 item 2: who auth login signs in as. --username sets this clone's identity; without it,
// the resolved username, as before.
export function profileForLogin(profile: InstanceProfile, username?: string): InstanceProfile {
  if (username === undefined) {
    return profile;
  }
  if (profile.auth.method !== "basic") {
    throw new InvalidInputError(
      "--username is for password sign-in; an OAuth client signs in as its Application User (ADR-0021)",
    );
  }
  if (usernameSource(profile) === "environment") {
    throw new InvalidInputError(
      `${usernameVariable(profile)} names the user and comes first; unset it to set this clone's identity`,
    );
  }
  return withUsername(profile, checkedUsername(username, "--username"), "clone");
}
