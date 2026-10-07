import { AsyncEntry } from "@napi-rs/keyring";
import {
  type CredentialStore,
  credentialAccount,
  credentialVariable,
  INSTANCE_KINDS,
  type InstanceProfile,
  SnagenticError,
  type StoredCredential,
} from "@snagentic/core";
import { z } from "zod";

export interface KeychainEntry {
  getPassword(): Promise<string | undefined | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type CreateKeychainEntry = (service: string, account: string) => KeychainEntry;

const SERVICE = "snagentic";

// ADR-0020: one item holds the secret and the settings it was stored for, so neither can be
// changed without the other.
const BoundSecret = z.object({
  snagentic: z.literal(1),
  secret: z.string(),
  url: z.string(),
  kind: z.enum(INSTANCE_KINDS),
});

function parseItem(value: string): StoredCredential {
  let json: unknown = null;
  try {
    json = JSON.parse(value);
  } catch {
    // An item stored by an earlier version holds the bare secret.
  }
  const bound = BoundSecret.safeParse(json);
  return bound.success
    ? {
        secret: bound.data.secret,
        source: "keychain",
        trusted: { url: bound.data.url, kind: bound.data.kind },
      }
    : { secret: value, source: "keychain", trusted: null };
}

class KeychainUnavailableError extends SnagenticError {
  constructor(profile: InstanceProfile, reason: string) {
    super(
      "keychain-unavailable",
      "precondition",
      `the OS keychain could not store the secret: ${reason}`,
      `set ${credentialVariable(profile)} instead (recommended for servers and CI)`,
    );
  }
}

// Secrets live under service "snagentic", account "<username>@<host>".
export class KeychainCredentialStore implements CredentialStore {
  constructor(
    private readonly createEntry: CreateKeychainEntry = (service, account) =>
      new AsyncEntry(service, account),
  ) {}

  async read(profile: InstanceProfile): Promise<StoredCredential | null> {
    try {
      const value = await this.entry(profile).getPassword();
      return value === undefined || value === null || value === "" ? null : parseItem(value);
    } catch {
      // No keychain (e.g. a headless Linux server): let other stores supply the secret.
      return null;
    }
  }

  async write(profile: InstanceProfile, secret: string): Promise<void> {
    try {
      const item = { snagentic: 1, secret, url: profile.url, kind: profile.kind };
      await this.entry(profile).setPassword(JSON.stringify(item));
    } catch (error) {
      throw new KeychainUnavailableError(
        profile,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async remove(profile: InstanceProfile): Promise<boolean> {
    try {
      return await this.entry(profile).deletePassword();
    } catch {
      return false;
    }
  }

  private entry(profile: InstanceProfile): KeychainEntry {
    return this.createEntry(SERVICE, credentialAccount(profile));
  }
}
