import { InvalidInputError } from "../../kernel/errors";
import type { InstanceName } from "../../kernel/instance-name";
import { ReadOnlyAcknowledgementRequiredError } from "./errors";
import { normalizeInstanceUrl } from "./instance-url";

export const INSTANCE_KINDS = ["development", "test", "production"] as const;
export type InstanceKind = (typeof INSTANCE_KINDS)[number];

export interface BasicAuth {
  readonly method: "basic";
  readonly username: string;
}

// ADR-0021: the instance signs the client in as its OAuth Application User, `username`.
export interface OAuthClientCredentials {
  readonly method: "oauth-client-credentials";
  readonly clientId: string;
  readonly username: string;
}

export type AuthSettings = BasicAuth | OAuthClientCredentials;

export interface InstanceProfile {
  readonly name: InstanceName;
  readonly url: string;
  readonly kind: InstanceKind;
  readonly auth: AuthSettings;
  readonly readOnlyAcknowledged: boolean;
}

export interface NewProfile {
  readonly name: InstanceName;
  readonly url: string;
  readonly username: string;
  // Given for an OAuth client (ADR-0021); Basic authentication otherwise.
  readonly clientId?: string;
  readonly kind: InstanceKind;
  readonly acknowledgeReadOnly: boolean;
}

// Checked on creation and again on every read: instance.yaml is a file anyone can edit.
export function usernameProblem(username: string): string | null {
  if (username === "") {
    return "username must not be empty";
  }
  // The username is used inside encoded queries, where ^ , and line breaks are syntax.
  if (/[\^,\r\n]/.test(username)) {
    return "username must not contain ^ , or line breaks";
  }
  return null;
}

// The client id names the keychain account, so it may not contain the account's separators.
export function clientIdProblem(clientId: string): string | null {
  return /^[A-Za-z0-9._-]+$/.test(clientId)
    ? null
    : "client id must be letters, digits, '.', '_' or '-'";
}

function authSettings(input: NewProfile): AuthSettings {
  const username = input.username.trim();
  const problem = usernameProblem(username);
  if (problem !== null) {
    throw new InvalidInputError(problem);
  }
  if (input.clientId === undefined) {
    return { method: "basic", username };
  }
  const clientId = input.clientId.trim();
  const clientProblem = clientIdProblem(clientId);
  if (clientProblem !== null) {
    throw new InvalidInputError(clientProblem);
  }
  return { method: "oauth-client-credentials", clientId, username };
}

export function createProfile(input: NewProfile): InstanceProfile {
  const auth = authSettings(input);
  // ADR-0013: until the read-only credential check exists (spike S6), the user must
  // confirm that test and production credentials cannot write.
  if (input.kind !== "development" && !input.acknowledgeReadOnly) {
    throw new ReadOnlyAcknowledgementRequiredError(input.kind);
  }
  return {
    name: input.name,
    url: normalizeInstanceUrl(input.url),
    kind: input.kind,
    auth,
    readOnlyAcknowledged: input.kind !== "development",
  };
}

// ADR-0002, ADR-0012: only development instances are ever written.
export function canWrite(profile: InstanceProfile): boolean {
  return profile.kind === "development";
}

export function instanceHost(profile: InstanceProfile): string {
  return profile.url.replace(/^https:\/\//, "");
}

// Keychain account under the "snagentic" service: <username>@<host>, or
// oauth:<client id>@<host>, so switching the method never releases the other kind of secret.
export function credentialAccount(profile: InstanceProfile): string {
  const auth = profile.auth;
  const who = auth.method === "basic" ? auth.username : `oauth:${auth.clientId}`;
  return `${who}@${instanceHost(profile)}`;
}

export function secretName(profile: InstanceProfile): string {
  return profile.auth.method === "basic" ? "password" : "client secret";
}

// Environment variable that supplies the secret in CI, e.g. SNAGENTIC_ACME_PROD_PASSWORD.
export function credentialVariable(profile: InstanceProfile): string {
  return `SNAGENTIC_${profile.name.toUpperCase().replaceAll("-", "_")}_PASSWORD`;
}

// All variables a CI job sets: the secret, and the url and kind that pin it (ADR-0020).
export function credentialVariables(profile: InstanceProfile): string {
  const prefix = credentialVariable(profile).replace(/_PASSWORD$/, "");
  return `${prefix}_PASSWORD, ${prefix}_URL and ${prefix}_KIND`;
}
