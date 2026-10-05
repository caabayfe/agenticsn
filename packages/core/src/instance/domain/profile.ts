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

export type AuthSettings = BasicAuth;

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
  readonly kind: InstanceKind;
  readonly acknowledgeReadOnly: boolean;
}

export function createProfile(input: NewProfile): InstanceProfile {
  const username = input.username.trim();
  if (username === "") {
    throw new InvalidInputError("username must not be empty");
  }
  // ADR-0013: until the read-only credential check exists (spike S6), the user must
  // confirm that test and production credentials cannot write.
  if (input.kind !== "development" && !input.acknowledgeReadOnly) {
    throw new ReadOnlyAcknowledgementRequiredError(input.kind);
  }
  return {
    name: input.name,
    url: normalizeInstanceUrl(input.url),
    kind: input.kind,
    auth: { method: "basic", username },
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

// Keychain account under the "snagentic" service: <username>@<host>.
export function credentialAccount(profile: InstanceProfile): string {
  return `${profile.auth.username}@${instanceHost(profile)}`;
}

// Environment variable that supplies the secret in CI, e.g. SNAGENTIC_ACME_PROD_PASSWORD.
export function credentialVariable(profile: InstanceProfile): string {
  return `SNAGENTIC_${profile.name.toUpperCase().replaceAll("-", "_")}_PASSWORD`;
}
