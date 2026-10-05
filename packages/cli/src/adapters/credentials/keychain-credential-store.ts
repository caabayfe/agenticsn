import { AsyncEntry } from "@napi-rs/keyring";
import {
  type CredentialStore,
  credentialAccount,
  credentialVariable,
  type InstanceProfile,
  SnagenticError,
} from "@snagentic/core";

export interface KeychainEntry {
  getPassword(): Promise<string | undefined | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type CreateKeychainEntry = (service: string, account: string) => KeychainEntry;

const SERVICE = "snagentic";

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

  async read(profile: InstanceProfile): Promise<string | null> {
    try {
      return (await this.entry(profile).getPassword()) ?? null;
    } catch {
      // No keychain (e.g. a headless Linux server): let other stores supply the secret.
      return null;
    }
  }

  async write(profile: InstanceProfile, secret: string): Promise<void> {
    try {
      await this.entry(profile).setPassword(secret);
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
